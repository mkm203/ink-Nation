// Image uploads. Files are held in memory, checked by their first bytes (the browser's
// claimed type is not trusted), and saved under a random name in /uploads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('./errors');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
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

// Saves an uploaded file and returns its public URL, or null when no file was sent.
async function saveImage(file) {
  if (!file) return null;
  const ext = sniff(file.buffer);
  if (!ext) throw new HttpError(400, 'Only JPG, PNG, GIF or WebP images are accepted.', { image: 'Choose a JPG, PNG, GIF or WebP image.' });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return '/uploads/' + name;
}

function removeImage(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return Promise.resolve();
  return fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
}

module.exports = { upload, saveImage, removeImage, UPLOAD_DIR };
