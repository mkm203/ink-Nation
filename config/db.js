// One SQLite database for the whole app. It is a file on disk, so there is no separate
// database server to install: the website and its data travel together.
//
// The rest of the app was written for mysql2, so this file keeps the same shape:
//   const [rows] = await db.query('SELECT ...')
//   const [result] = await db.query('INSERT ...')  // result.insertId / result.affectedRows
//   const conn = await db.getConnection(); conn.beginTransaction(); ...
// Queries are fast and synchronous underneath. Transactions take an exclusive turn so two
// requests can never interleave their statements (this keeps stock and booking slots correct).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config({ quiet: true });

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(ROOT, 'data', 'inkster.db'));
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec('PRAGMA busy_timeout = 5000');

// ---- one-at-a-time writes -------------------------------------------------
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

function run(sql, params) {
  const values = cleanParams(params);
  const statement = sqlite.prepare(sql);
  if (isRead(sql)) return [statement.all(...values), undefined];
  const result = statement.run(...values);
  return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }, undefined];
}

async function query(sql, params) {
  let mine = false;
  if (locked) { await acquire(); mine = true; }
  try { return run(sql, params); }
  finally { if (mine) release(); }
}

async function exec(sql) {
  let mine = false;
  if (locked) { await acquire(); mine = true; }
  try { sqlite.exec(sql); return undefined; }
  finally { if (mine) release(); }
}

// A connection object for a transaction. Every statement on it runs on the same SQLite file.
// The lock is held until release(), so code may safely read its own writes after COMMIT.
function getConnection() {
  let held = false;
  let finished = false;
  return {
    async query(sql, params) { return run(sql, params); },
    async beginTransaction() {
      if (held) return;
      await acquire(); held = true;
      try { sqlite.exec('BEGIN IMMEDIATE'); }
      catch (e) { held = false; release(); throw e; }
    },
    async commit() {
      if (!held || finished) return;
      finished = true;
      sqlite.exec('COMMIT');
    },
    async rollback() {
      if (!held || finished) return;
      finished = true;
      try { sqlite.exec('ROLLBACK'); } catch { /* already rolled back */ }
    },
    release() {
      if (!held) return;
      held = false;
      release();
    }
  };
}

async function end() {
  // Let any transaction in flight finish, then close the file cleanly.
  await acquire();
  try { sqlite.close(); } finally { locked = false; }
}

module.exports = { query, exec, getConnection, end, DB_FILE };
