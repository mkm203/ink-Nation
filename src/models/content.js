const db = require('../../config/db');

async function settings() {
  const [rows] = await db.query('SELECT k, v FROM settings');
  return Object.fromEntries(rows.map(r => [r.k, r.v]));
}

async function saveSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    const value = v == null ? '' : String(v);
    await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, value]);
  }
}

const artists = (activeOnly = true) =>
  db.query(`SELECT id, slug, name, bio, specialty, experience_years, photo, art_key, sort_order, active FROM artists
            ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`).then(r => r[0]);

const works = () =>
  db.query(`SELECT w.id, w.title, w.description, w.image, w.art_key, w.sort_order, w.artist_id, a.name AS artist_name, a.slug AS artist_slug
            FROM works w LEFT JOIN artists a ON a.id = w.artist_id ORDER BY w.sort_order, w.id`).then(r => r[0]);

const faqs = () => db.query('SELECT id, question, answer, sort_order FROM faqs ORDER BY sort_order, id').then(r => r[0]);

const reviews = () => db.query('SELECT id, name, rating, review, sort_order, created_at FROM reviews WHERE active = 1 ORDER BY sort_order, id DESC').then(r => r[0]);

module.exports = { settings, saveSettings, artists, works, faqs, reviews };
