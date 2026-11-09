// Copies the content of the old MySQL/MariaDB database (XAMPP) into the SQLite file.
//
//   1. npm run db:init                       (creates the SQLite file and tables)
//   2. npm install mysql2 --no-save --no-package-lock
//   3. npm run db:import                     (reads DB_HOST, DB_USER, ... from .env)
//
// It replaces the rows in the SQLite file with the MySQL rows, keeping the same ids so
// bookings and orders still point at the right artists and products.
// Uploaded files live in uploads/ and are not touched; copy that folder to the host separately.
const path = require('path');
require('dotenv').config({ quiet: true });

const env = k => (process.env[k] || '').trim();
const db = require('../config/db');
const { init } = require('./init-db');

// Parents before children. `target` is the conflict key used for the upsert.
const TABLES = [
  ['settings', 'k', ['k', 'v']],
  ['payment_methods', 'method', ['method', 'label', 'enabled', 'account', 'instructions', 'sort_order']],
  ['artists', 'id', ['id', 'slug', 'name', 'bio', 'specialty', 'experience_years', 'photo', 'art_key', 'sort_order', 'active']],
  ['artist_photos', 'id', ['id', 'artist_id', 'image', 'title', 'sort_order']],
  ['works', 'id', ['id', 'title', 'artist_id', 'description', 'image', 'art_key', 'sort_order']],
  ['faqs', 'id', ['id', 'question', 'answer', 'sort_order']],
  ['reviews', 'id', ['id', 'name', 'image', 'rating', 'review', 'sort_order', 'active', 'created_at']],
  ['price_tiers', 'id', ['id', 'name', 'description', 'price_cents', 'price_max_cents', 'deposit_cents', 'image', 'sort_order', 'active']],
  ['products', 'id', ['id', 'name', 'category', 'description', 'price_cents', 'stock', 'image', 'sort_order', 'active']],
  ['bookings', 'id', [
    'id', 'reference', 'name', 'phone', 'email', 'artist_id', 'piece', 'colour_mode', 'preferred_date',
    'idea', 'reference_image', 'tier_id', 'deposit_cents', 'deposit_paid', 'status', 'created_at', 'updated_at'
  ]],
  ['inquiries', 'id', ['id', 'name', 'email', 'question', 'handled', 'created_at']],
  ['orders', 'id', [
    'id', 'reference', 'kind', 'booking_id', 'name', 'email', 'phone', 'note', 'total_cents', 'method',
    'status', 'payment_note', 'stripe_session_id', 'pay_url', 'pay_to', 'btc_sats', 'btc_rate',
    'created_at', 'updated_at', 'paid_at'
  ]],
  ['order_items', 'id', ['id', 'order_id', 'product_id', 'name', 'unit_cents', 'qty']]
];

// Children first, so foreign keys never block a delete.
const DELETE_ORDER = [...TABLES].reverse().map(t => t[0]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    fail('mysql2 is not installed. Run this first, then try again:\n  npm install mysql2 --no-save --no-package-lock');
  }

  const database = process.argv[2] || env('DB_NAME') || 'inkster_db';
  console.log(`Reading ${database} from MySQL at ${env('DB_HOST') || 'localhost'}:${env('DB_PORT') || 3306} ...`);

  let source;
  try {
    source = await mysql.createConnection({
      host: env('DB_HOST') || 'localhost',
      port: Number(env('DB_PORT')) || 3306,
      user: env('DB_USER') || 'root',
      password: process.env.DB_PASSWORD || '',
      database
    });
  } catch (e) {
    const detail = e.message || e.code || 'connection refused';
    fail(`Cannot connect to MySQL: ${detail}\nStart MySQL (XAMPP) and check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in .env.`);
  }

  // Which tables and columns really exist in the old database.
  const [cols] = await source.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?',
    [database]
  );
  const have = new Map();
  for (const { t, c } of cols) {
    if (!have.has(t)) have.set(t, new Set());
    have.get(t).add(c);
  }

  await init(); // make sure the SQLite schema exists (and starter content does not block ids)

  // Replace what is in SQLite with the MySQL rows.
  for (const table of DELETE_ORDER) {
    if (have.has(table)) await db.query(`DELETE FROM ${table}`);
  }

  let copied = 0;
  for (const [table, target, columns] of TABLES) {
    if (!have.has(table)) { console.log(`  ${table}: not in the old database, skipped`); continue; }
    const usable = columns.filter(c => have.get(table).has(c));
    if (!usable.includes(target)) { console.log(`  ${table}: no "${target}" column, skipped`); continue; }

    const [rows] = await source.query(`SELECT ${usable.map(c => `\`${c}\``).join(', ')} FROM \`${table}\``);
    const updates = usable.filter(c => c !== target).map(c => `${c} = excluded.${c}`).join(', ');
    for (const row of rows) {
      await db.query(
        `INSERT INTO ${table} (${usable.join(',')}) VALUES (${usable.map(() => '?').join(',')})
         ON CONFLICT(${target}) DO UPDATE SET ${updates}`,
        usable.map(c => (row[c] === undefined ? null : row[c]))
      );
    }
    copied += rows.length;
    console.log(`  ${table}: ${rows.length} rows`);
  }

  await source.end();

  // Older databases kept each artist's pieces in `works`. Their galleries now live in
  // `artist_photos`, so carry any artist-linked work with a picture across, once.
  const [artistWorks] = await db.query(
    `SELECT w.artist_id, w.image, w.title, w.sort_order FROM works w
     WHERE w.artist_id IS NOT NULL AND w.image IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM artist_photos p WHERE p.artist_id = w.artist_id AND p.image = w.image)
     ORDER BY w.artist_id, w.sort_order, w.id`
  );
  for (const w of artistWorks) {
    await db.query(
      'INSERT INTO artist_photos (artist_id, image, title, sort_order) VALUES (?,?,?,?)',
      [w.artist_id, w.image, w.title || '', w.sort_order || 0]
    );
  }
  if (artistWorks.length) console.log(`  artist_photos: ${artistWorks.length} older artist work(s) moved into the galleries`);

  await db.end();
  console.log(`\nDone. ${copied} rows copied into ${path.relative(process.cwd(), db.DB_FILE)}.`);
  console.log('If you are moving to a host, also copy the uploads/ folder (or point UPLOAD_DIR at it).');
}

main().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
