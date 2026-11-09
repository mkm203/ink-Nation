// Image uploads. Files are held in memory, checked by their first bytes (the browser's
// claimed type is not trusted), and saved under a random name.
// Where they are saved: the /uploads folder (your computer, or a host with a persistent disk), or the database
// (table ink_files). When the database is Turso, photos go into it automatically, because a free Render server
// erases its own files. UPLOAD_STORAGE=disk or db forces one. Files already in /uploads keep working in both modes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config({ quiet: true });
const { HttpError } = require('./errors');
const db = require('../../config/db');
const cloud = require('./cloudinary');

// A host such as Render gives you a persistent disk and points UPLOAD_DIR at it.
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 30 } });

function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const CHUNK = 256 * 1024; // a file is cut into 256 KB pieces, saved 4 at a time (about 1 MB per request)
const GROUP = 4;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
const inDatabase = () => { const v = (process.env.UPLOAD_STORAGE || '').trim().toLowerCase(); return v ? v === 'db' : db.REMOTE; };

// Small memory cache so a video that is played in pieces is not read from the database for every piece.
const cache = new Map();
let cacheBytes = 0;
const CACHE_MAX = 48 * 1024 * 1024;
function remember(name, buf) {
  if (buf.length > CACHE_MAX) return;
  cache.set(name, buf); cacheBytes += buf.length;
  for (const [k, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(k); cacheBytes -= v.length; }
}
function forget(name) { const v = cache.get(name); if (v) { cache.delete(name); cacheBytes -= v.length; } }

// Stores the bytes under this name, on disk or in the database.
async function putFile(name, buffer) {
  if (!inDatabase()) { await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer); return; }
  try {
    for (let at = 0, seq = 0; at < buffer.length;) {
      const group = [];
      for (let i = 0; i < GROUP && at < buffer.length; i++, seq++, at += CHUNK) group.push(['INSERT INTO ink_files (name, seq, data) VALUES (?,?,?)', [name, seq, buffer.subarray(at, at + CHUNK)]]);
      await db.batch(group);
    }
  } catch (e) { await db.query('DELETE FROM ink_files WHERE name = ?', [name]).catch(() => {}); throw e; }
}

async function loadFile(name) {
  if (cache.has(name)) return cache.get(name);
  const parts = [];
  for (let from = 0; ; from += GROUP) {
    const [rows] = await db.query('SELECT data FROM ink_files WHERE name = ? AND seq >= ? AND seq < ? ORDER BY seq', [name, from, from + GROUP]);
    for (const r of rows) parts.push(Buffer.from(r.data));
    if (rows.length < GROUP) break;
  }
  if (!parts.length) return null;
  const buf = Buffer.concat(parts);
  remember(name, buf);
  return buf;
}

// Serves /uploads/<name> from the database. Understands "Range" requests, which Safari and iPhones need to play a video.
async function serveStored(req, res, next) {
  const m = /^[a-f0-9]{24}\.(jpg|png|gif|webp|mp4|webm)$/.exec(req.params.name || '');
  if (!m) return next();
  const buf = await loadFile(req.params.name);
  if (!buf) return next();
  res.set({ 'Content-Type': TYPES[m[1]], 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800, immutable' });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range || (range[1] === '' && range[2] === '')) return res.send(buf);
  let start, end;
  if (range[1] === '') { start = Math.max(0, buf.length - Number(range[2])); end = buf.length - 1; }
  else { start = Number(range[1]); end = range[2] === '' ? buf.length - 1 : Math.min(Number(range[2]), buf.length - 1); }
  if (start > end || start >= buf.length) return res.status(416).set('Content-Range', `bytes */${buf.length}`).end();
  res.status(206).set('Content-Range', `bytes ${start}-${end}/${buf.length}`).send(buf.subarray(start, end + 1));
}

// Saves an uploaded file and returns its public URL, or null when no file was sent.
// With CLOUDINARY_URL set the file goes to Cloudinary (fast CDN, resized automatically), otherwise to disk or the database.
async function saveImage(file) {
  if (!file) return null;
  const ext = sniff(file.buffer);
  if (!ext) throw new HttpError(400, 'Only JPG, PNG, GIF or WebP images are accepted.', { image: 'Choose a JPG, PNG, GIF or WebP image.' });
  if (cloud.enabled()) return cloud.uploadBuffer(file.buffer, 'image', TYPES[ext]);
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  await putFile(name, file.buffer);
  return '/uploads/' + name;
}

// Deletes the file wherever it is (disk and database), so nothing is left behind.
function removeImage(url) {
  if (cloud.isOurs(url)) return cloud.destroy(url);
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return Promise.resolve();
  const name = path.basename(url);
  forget(name);
  return Promise.all([
    fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch(() => {}),
    db.query('DELETE FROM ink_files WHERE name = ?', [name]).catch(() => {})
  ]).then(() => undefined);
}

module.exports = { upload, saveImage, removeImage, putFile, loadFile, serveStored, inDatabase, UPLOAD_DIR, TYPES };
