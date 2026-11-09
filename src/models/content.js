const db = require('../../config/db');

async function settings() {
  const [rows] = await db.query('SELECT k, v FROM settings');
  return Object.fromEntries(rows.map(r => [r.k, r.v]));
}

async function saveSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    const value = v == null ? '' : String(v);
    await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, value]);
  }
}

// Artists come with their personal gallery, which the team section shows next to each person.
async function artists(activeOnly = true) {
  const [rows] = await db.query(`SELECT id, slug, name, bio, specialty, experience_years, photo, art_key, sort_order, active FROM artists
            ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`);
  rows.forEach(r => { r.photos = []; });
  if (rows.length) {
    const [photos] = await db.query(
      `SELECT id, artist_id, image, title, sort_order FROM artist_photos
       WHERE artist_id IN (${rows.map(() => '?').join(',')}) ORDER BY sort_order, id`,
      rows.map(r => r.id));
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const p of photos) {
      const artist = byId.get(p.artist_id);
      if (artist) artist.photos.push({ id: p.id, image: p.image, title: p.title });
    }
  }
  return rows;
}

// Only studio pieces belong in "Recent work". Each artist's own work lives in their gallery instead.
const works = () =>
  db.query(`SELECT w.id, w.title, w.description, w.image, w.art_key, w.sort_order, w.artist_id
            FROM works w WHERE w.artist_id IS NULL ORDER BY w.sort_order, w.id`).then(r => r[0]);

const faqs = () => db.query('SELECT id, question, answer, sort_order FROM faqs ORDER BY sort_order, id').then(r => r[0]);

const reviews = () => db.query('SELECT id, name, image, rating, review, sort_order, created_at FROM reviews WHERE active = 1 ORDER BY sort_order, id DESC').then(r => r[0]);

module.exports = { settings, saveSettings, artists, works, faqs, reviews };
