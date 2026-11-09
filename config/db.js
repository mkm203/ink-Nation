// One SQLite database for the whole app. It lives in one of two places:
//
//   1. A file on this computer (the default). Nothing to install or sign up for.
//      DB_FILE changes where the file is. Good for your own computer and for hosts with a persistent disk.
//   2. A free hosted SQLite database on Turso, when TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) are set.
//      This is for hosts that erase their disk, like Render's free plan: the data lives on Turso, not on the host.
//
// The rest of the app was written for mysql2, so this file keeps the same shape in both cases:
//   const [rows] = await db.query('SELECT ...')
//   const [result] = await db.query('INSERT ...')  // result.insertId / result.affectedRows
//   const conn = await db.getConnection(); conn.beginTransaction(); ...
// Transactions take an exclusive turn so two requests can never interleave their statements
// (this keeps stock and booking slots correct).
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });

const env = k => (process.env[k] || '').trim().replace(/^["']+|["']+$/g, ''); // tolerate quotes or spaces pasted around a value
const REMOTE_URL = env('TURSO_DATABASE_URL');
const REMOTE = !!REMOTE_URL;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- helpers shared by both kinds of database ------------------------------
function cleanParams(params) {
  if (!params) return [];
  return (Array.isArray(params) ? params : [params]).map(v => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    return v;
  });
}

function isRead(sql) {
  const s = String(sql).replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/g, '');
  return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(s);
}

// ---- 1. a file on this computer --------------------------------------------
function localBackend() {
  const { DatabaseSync } = require('node:sqlite'); // only loaded when it is needed
  const file = path.resolve(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'inkster.db'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const run = (sql, params) => {
    const values = cleanParams(params);
    const statement = sqlite.prepare(sql);
    if (isRead(sql)) return [statement.all(...values), undefined];
    const result = statement.run(...values);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }, undefined];
  };
  return {
    label: file,
    run: async (sql, params) => run(sql, params),
    exec: async sql => { sqlite.exec(sql); },
    async begin() {
      sqlite.exec('BEGIN IMMEDIATE');
      return { run: async (sql, params) => run(sql, params), commit: async () => sqlite.exec('COMMIT'), rollback: async () => sqlite.exec('ROLLBACK'), close() {} };
    },
    async batch(list) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const out = list.map(([sql, params]) => run(sql, params)); sqlite.exec('COMMIT'); return out; }
      catch (e) { try { sqlite.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    },
    async close() { sqlite.close(); }
  };
}

// ---- 2. Turso (hosted SQLite, reached over HTTPS) ---------------------------
function remoteBackend() {
  const { createClient } = require('@libsql/client/web'); // the web build needs no native add-on
  const url = REMOTE_URL.replace(/^libsql:/i, 'https:'); // plain HTTPS: stateless, survives idle connections
  const client = createClient({ url, authToken: env('TURSO_AUTH_TOKEN') || undefined });
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();

  const plain = (columns, row) => {
    const o = {};
    columns.forEach((c, i) => { const v = row[i]; o[c] = v instanceof ArrayBuffer ? Buffer.from(v) : typeof v === 'bigint' ? Number(v) : v; });
    return o;
  };
  const shape = (sql, r) => isRead(sql)
    ? [r.rows.map(row => plain(r.columns, row)), undefined]
    : [{ insertId: Number(r.lastInsertRowid || 0), affectedRows: Number(r.rowsAffected) }, undefined];

  // Reading again is harmless, so a short network hiccup is retried for reads. Writes are never repeated.
  const transient = e => /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|HTTP status 50[234]|HTTP status 429/i.test(`${e && e.message} ${e && e.cause && (e.cause.code || e.cause.message)}`);
  async function exec1(target, sql, params) {
    const args = cleanParams(params);
    for (let attempt = 0; ; attempt++) {
      try { return shape(sql, await target.execute({ sql, args })); }
      catch (e) { if (!isRead(sql) || attempt >= 2 || !transient(e)) throw e; await sleep(300 * (attempt + 1)); }
    }
  }
  return {
    label: `Turso database ${host}`,
    run: (sql, params) => exec1(client, sql, params),
    exec: async sql => { await client.executeMultiple(sql); },
    async begin() {
      const tx = await client.transaction('write'); // BEGIN IMMEDIATE on the server
      return { run: (sql, params) => exec1(tx, sql, params), commit: () => tx.commit(), rollback: () => tx.rollback(), close: () => tx.close() };
    },
    // Several statements in ONE request, all or nothing. Used to store uploaded files quickly.
    async batch(list) {
      const results = await client.batch(list.map(([sql, params]) => ({ sql, args: cleanParams(params) })), 'write');
      return results.map((r, i) => shape(list[i][0], r));
    },
    async close() { client.close(); }
  };
}

const backend = REMOTE ? remoteBackend() : localBackend();

// ---- one-at-a-time transactions ---------------------------------------------
// Plain queries run immediately. A transaction holds the lock from BEGIN until release(),
// so its statements cannot be mixed with another request's statements.
let locked = false;
const waiters = [];
function acquire() {
  if (!locked) { locked = true; return Promise.resolve(); }
  return new Promise(resolve => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next(); // the lock passes straight to the next waiter
  else locked = false;
}

async function query(sql, params) {
  let mine = false;
  if (locked) { await acquire(); mine = true; }
  try { return await backend.run(sql, params); }
  finally { if (mine) release(); }
}

async function exec(sql) {
  let mine = false;
  if (locked) { await acquire(); mine = true; }
  try { await backend.exec(sql); return undefined; }
  finally { if (mine) release(); }
}

// Runs [[sql, params], ...] together, all or nothing. Returns one result per statement.
async function batch(list) {
  let mine = false;
  if (locked) { await acquire(); mine = true; }
  try { return (await backend.batch(list)).map(r => r); }
  finally { if (mine) release(); }
}

// A connection object for a transaction. The lock is held until release(), so code may
// safely read its own writes after COMMIT (those reads run on the same connection object).
function getConnection() {
  let held = false;
  let finished = false;
  let tx = null;
  return {
    async query(sql, params) { return tx && !finished ? tx.run(sql, params) : backend.run(sql, params); },
    async beginTransaction() {
      if (held) return;
      await acquire(); held = true;
      try { tx = await backend.begin(); }
      catch (e) { held = false; release(); throw e; }
    },
    async commit() {
      if (!held || finished) return;
      finished = true;
      await tx.commit();
    },
    async rollback() {
      if (!held || finished) return;
      finished = true;
      try { await tx.rollback(); } catch { /* already rolled back */ }
    },
    release() {
      if (!held) return;
      held = false;
      const done = finished ? Promise.resolve() : (finished = true, Promise.resolve(tx.rollback()).catch(() => {})); // never leave a transaction open
      done.then(() => { try { tx.close(); } catch { /* closed */ } release(); });
    }
  };
}

async function end() {
  // Let any transaction in flight finish, then close the database cleanly.
  await acquire();
  try { await backend.close(); } finally { locked = false; }
}

module.exports = { query, exec, batch, getConnection, end, DB_FILE: backend.label, REMOTE };
