// Moves photos and the video stored before Cloudinary was set up (in the database or the uploads folder) to Cloudinary,
// and points every row at the new address. Started from Admin > Studio. Safe to run again: only /uploads/... addresses are moved.
const fs = require('fs');
const path = require('path');
const db = require('../../config/db');
const cloud = require('./cloudinary');
const { loadFile, UPLOAD_DIR, TYPES } = require('./images');

// Every column that can hold an uploaded file's address.
const COLUMNS = [['artists', 'photo'], ['artist_photos', 'image'], ['works', 'image'], ['reviews', 'image'], ['price_tiers', 'image'], ['products', 'image'], ['bookings', 'reference_image']];
const SETTINGS = ['hero_image', 'team_video'];
const LOCAL = /^\/uploads\/([a-f0-9]{24}\.(jpg|png|gif|webp|mp4|webm))$/;

async function pending() {
  const urls = new Set();
  for (const [t, c] of COLUMNS) for (const r of (await db.query(`SELECT DISTINCT ${c} u FROM ${t} WHERE ${c} LIKE '/uploads/%'`))[0]) urls.add(r.u);
  for (const r of (await db.query(`SELECT v u FROM settings WHERE k IN (${SETTINGS.map(() => '?').join(',')}) AND v LIKE '/uploads/%'`, SETTINGS))[0]) urls.add(r.u);
  return [...urls].filter(u => LOCAL.test(u));
}

async function bytes(name) {
  try { return await fs.promises.readFile(path.join(UPLOAD_DIR, name)); } catch { /* not on disk */ }
  return loadFile(name);
}

async function moveAll() {
  if (!cloud.enabled()) throw new Error('CLOUDINARY_URL is not set.');
  const out = { moved: 0, missing: [], failed: [] };
  for (const url of await pending()) {
    const [, name, ext] = LOCAL.exec(url);
    const buf = await bytes(name);
    if (!buf) { out.missing.push(url); continue; }
    let next;
    try { next = await cloud.uploadBuffer(buf, /^(mp4|webm)$/.test(ext) ? 'video' : 'image', TYPES[ext]); }
    catch { out.failed.push(url); continue; }
    for (const [t, c] of COLUMNS) await db.query(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, [next, url]);
    await db.query('UPDATE settings SET v = ? WHERE v = ?', [next, url]);
    await db.query('DELETE FROM ink_files WHERE name = ?', [name]); // frees space in Turso; the disk copy (if any) is left alone
    out.moved++;
  }
  return out;
}

module.exports = { pending, moveAll };
