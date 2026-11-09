require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const multer = require('multer');
const { HttpError } = require('./src/lib/errors');
const { UPLOAD_DIR } = require('./src/lib/images');
const db = require('./config/db');

const app = express();
app.disable('x-powered-by');
// Render and other hosts put a proxy in front of the app; this keeps rate limits and IPs correct.
app.set('trust proxy', 1);
// Stripe's webhook needs the raw body to check the signature, so it is registered before the JSON parser.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '200kb' }), require('./src/routes/webhooks'));
app.use(express.json({ limit: '100kb' }));

// Light security headers for every response.
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unreachable' }); }
});
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/public'));
app.use('/api', require('./src/routes/shop'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Uploaded photos, then the website itself.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
app.use(express.static(path.join(__dirname, 'public')));

// One place that turns every error into JSON the page can show.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err instanceof multer.MulterError) {
    const big = err.code === 'LIMIT_FILE_SIZE';
    return res.status(big ? 413 : 400).json({ error: big ? 'That image is larger than 5 MB.' : 'The upload was not accepted.', fields: big ? { image: 'Maximum 5 MB.' } : undefined });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  // On a fresh host (Render) the schema and starter content are created on first boot.
  const { init } = require('./scripts/init-db');
  init()
    .then(() => {
      console.log(`Database file: ${db.DB_FILE}`);
      console.log(`Uploads folder: ${UPLOAD_DIR}`);
      // Render's filesystem is wiped on every deploy unless the data is under a mounted disk.
      if ((process.env.RENDER || process.env.RENDER_SERVICE_ID) && !String(db.DB_FILE).startsWith('/var/data')) {
        console.warn('WARNING: the database is not on a persistent disk. Attach a disk at /var/data and set');
        console.warn('         DB_FILE=/var/data/inkster.db and UPLOAD_DIR=/var/data/uploads, or data is lost on deploy.');
      }
      app.listen(PORT, () => console.log(`Ink Nation is running at http://localhost:${PORT}`));
      // Unpaid orders give their stock back after a day.
      const sweep = () => require('./src/models/orders').expireStale().catch(e => console.error('Order sweep failed:', e.message));
      sweep(); setInterval(sweep, 10 * 60 * 1000).unref();
    })
    .catch(e => { console.error('Database setup failed:', e.message, '\nCheck DB_FILE (and UPLOAD_DIR on a host) then try again.'); process.exit(1); });
}
module.exports = app;
