// Copies your website (the data/inkster.db file and the uploads folder on your computer) into your Turso database.
// You run this ONCE, on your computer, after creating the free Turso database. See DEPLOY.md.
//
//   PowerShell:
//     $env:TURSO_DATABASE_URL = "libsql://your-database-name.turso.io"
//     $env:TURSO_AUTH_TOKEN   = "the long token Turso gave you"
//     node scripts/push-to-turso.js
//
// Optional: node scripts/push-to-turso.js [path\to\inkster.db] [path\to\uploads]
// It REPLACES what is in the Turso database with your local copy, and asks you to confirm first (--yes skips the question).
// Your local files are only read, never changed.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const yes = process.argv.includes('--yes');
const root = path.join(__dirname, '..');
const sourceFile = path.resolve(args[0] || path.join(root, 'data', 'inkster.db'));
const uploadsDir = path.resolve(args[1] || path.join(root, 'uploads'));

if (!(process.env.TURSO_DATABASE_URL || '').trim()) {
  console.error('TURSO_DATABASE_URL is not set, so there is nowhere to copy to.');
  console.error('In PowerShell, first run:');
  console.error('  $env:TURSO_DATABASE_URL = "libsql://your-database-name.turso.io"');
  console.error('  $env:TURSO_AUTH_TOKEN   = "your token"');
  process.exit(1);
}
if (!fs.existsSync(sourceFile)) { console.error(`Cannot find your local database file: ${sourceFile}\nRun this from the project folder, or give the path: node scripts/push-to-turso.js path\\to\\inkster.db`); process.exit(1); }

process.env.UPLOAD_STORAGE = 'db'; // pictures go into the database, whatever the settings say
const { DatabaseSync } = require('node:sqlite');
const db = require('../config/db');
const { putFile } = require('../src/lib/images');

// Parents before children, so every link points at a row that already exists.
const ORDER = ['artists', 'works', 'artist_photos', 'faqs', 'reviews', 'settings', 'price_tiers', 'products', 'payment_methods', 'bookings', 'inquiries', 'orders', 'order_items'];
const FILE = /^[a-f0-9]{24}\.(jpg|png|gif|webp|mp4|webm)$/;
const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });
const qcols = cols => cols.map(c => `"${c}"`).join(', ');

(async () => {
  if (!db.REMOTE) throw new Error('Turso is not selected (TURSO_DATABASE_URL is empty).');
  const source = new DatabaseSync(sourceFile);
  const have = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  const tables = ORDER.filter(t => have.has(t));
  const mine = {};
  for (const t of tables) mine[t] = source.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

  await db.exec(fs.readFileSync(path.join(root, 'sql', 'schema.sql'), 'utf8')); // makes the tables if the database is new
  const there = {};
  for (const t of ORDER) there[t] = (await db.query(`SELECT COUNT(*) AS n FROM ${t}`))[0][0].n;
  const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter(f => FILE.test(f)) : [];

  console.log(`\nCopy FROM  ${sourceFile}`);
  console.log(`      TO   ${db.DB_FILE}\n`);
  console.log('Table'.padEnd(18) + 'on your computer'.padEnd(20) + 'in Turso now (will be deleted)');
  for (const t of ORDER) console.log(t.padEnd(18) + String(mine[t] ?? '-').padEnd(20) + there[t]);
  console.log(`\nPictures and video in ${uploadsDir}: ${files.length} file(s)\n`);
  if (!yes) {
    const a = await ask('This REPLACES everything in the Turso database with your local copy. Type YES to continue: ');
    if (a !== 'YES') { console.log('Cancelled. Nothing was changed.'); await db.end(); return; }
  }

  // 1. empty the destination (children first), then copy table by table
  for (const t of [...ORDER].reverse()) await db.query(`DELETE FROM ${t}`);
  await db.query('DELETE FROM ink_files');
  const referenced = new Set();
  for (const t of tables) {
    const dest = (await db.query(`PRAGMA table_info(${t})`))[0].map(r => r.name);
    const src = source.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
    const cols = src.filter(c => dest.includes(c));
    const rows = source.prepare(`SELECT ${qcols(cols)} FROM ${t}`).all();
    const sql = `INSERT INTO ${t} (${qcols(cols)}) VALUES (${cols.map(() => '?').join(',')})`;
    for (let i = 0; i < rows.length; i += 25) {
      await db.batch(rows.slice(i, i + 25).map(r => [sql, cols.map(c => r[c])]));
    }
    for (const r of rows) for (const c of cols) if (typeof r[c] === 'string') for (const m of r[c].matchAll(/\/uploads\/([a-f0-9]{24}\.[a-z0-9]+)/g)) referenced.add(m[1]);
    console.log(`  copied ${String(rows.length).padStart(4)} row(s) into ${t}`);
  }

  // 2. pictures and video go into the database, where they survive restarts
  let done = 0;
  for (const f of files) {
    await db.query('DELETE FROM ink_files WHERE name = ?', [f]);
    await putFile(f, fs.readFileSync(path.join(uploadsDir, f)));
    process.stdout.write(`\r  uploaded file ${++done} of ${files.length}   `);
  }
  if (files.length) process.stdout.write('\n');

  const stored = new Set((await db.query('SELECT DISTINCT name FROM ink_files'))[0].map(r => r.name));
  const missing = [...referenced].filter(n => !stored.has(n));
  console.log('\nDone. Your content is now in Turso.');
  if (missing.length) {
    console.log(`\nNote: ${missing.length} picture(s) mentioned in your data were not found in the uploads folder, so they will show as missing:`);
    for (const m of missing) console.log('   /uploads/' + m);
    console.log('Upload those again in the admin area (the artist, work or review that uses them).');
  }
  source.close();
  await db.end();
})().catch(e => { console.error('\nCopy failed:', e.message); process.exit(1); });
