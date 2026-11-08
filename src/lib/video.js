// Video upload for the studio clip. Like images: held in memory, identified by its first bytes (MP4 or WebM), saved under a random name.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('./errors');
const { UPLOAD_DIR } = require('./images');

const MAX_MB = 30;
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1, fields: 5 } }).single('video');

// Express middleware that turns multer's errors into messages that talk about video, not images.
function uploadVideo(req, res, next) {
  uploader(req, res, err => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That video is larger than ${MAX_MB} MB. Compress it first (a 10 to 20 second loop is plenty).`, { video: `Maximum ${MAX_MB} MB.` }));
    next(new HttpError(400, 'The upload was not accepted.'));
  });
}

function sniff(b) {
  if (b.length < 12) return null;
  if (b.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
}

async function saveVideo(file) {
  if (!file) return null;
  const ext = sniff(file.buffer);
  if (!ext) throw new HttpError(400, 'Only MP4 or WebM videos are accepted.', { video: 'Choose an MP4 or WebM video.' });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return '/uploads/' + name;
}

module.exports = { uploadVideo, saveVideo };
