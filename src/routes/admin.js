const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../config/db');
const content = require('../models/content');
const bookings = require('../models/bookings');
const orders = require('../models/orders');
const pay = require('../lib/payments');
const { login, logout, requireAdmin } = require('../middleware/auth');
const { HttpError } = require('../lib/errors');
const { parse, parseOrThrow, intParam } = require('../lib/fields');
const { upload, saveImage, removeImage } = require('../lib/images');
const { uploadVideo, saveVideo } = require('../lib/video');

const router = express.Router();

router.post('/login', rateLimit({
  windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 100000 : 10, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' })
}), login);
router.post('/logout', logout);

// Everything below needs the admin cookie.
router.use(requireAdmin);
router.get('/me', (req, res) => res.json({ ok: true }));

// ---- bookings
router.get('/stats', async (req, res) => res.json({ ...(await bookings.stats()), ...(await orders.stats()) }));

router.get('/bookings', async (req, res) => {
  const status = req.query.status || '';
  if (status && !['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) throw new HttpError(400, 'Unknown status.');
  const page = req.query.page ? intParam(req.query.page, 'page') : 1;
  const limit = Math.min(req.query.limit ? intParam(req.query.limit, 'limit') : 20, 100);
  const artistId = req.query.artistId ? intParam(req.query.artistId, 'artistId') : null;
  res.json(await bookings.list({ status, artistId, q: String(req.query.q || '').slice(0, 80), page, limit }));
});

router.patch('/bookings/:id', async (req, res) => {
  const { status } = parseOrThrow({ status: { type: 'enum', required: true, values: ['pending', 'confirmed', 'completed', 'cancelled'] } }, req.body);
  res.json(await bookings.setStatus(intParam(req.params.id), status));
});

router.delete('/bookings/:id', async (req, res) => {
  const row = await bookings.remove(intParam(req.params.id));
  await removeImage(row.reference_image);
  res.status(204).end();
});

// ---- questions from the website
router.get('/inquiries', async (req, res) => res.json((await db.query('SELECT * FROM inquiries ORDER BY handled, id DESC'))[0]));
router.patch('/inquiries/:id', async (req, res) => {
  const { handled } = parseOrThrow({ handled: { type: 'bool', required: true } }, req.body);
  const [r] = await db.query('UPDATE inquiries SET handled = ? WHERE id = ?', [handled, intParam(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Question not found.');
  res.json({ ok: true });
});
router.delete('/inquiries/:id', async (req, res) => {
  const [r] = await db.query('DELETE FROM inquiries WHERE id = ?', [intParam(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Question not found.');
  res.status(204).end();
});

// ---- studio details and hero photo
const STUDIO_SPEC = {
  studio_name: { type: 'str', required: true, max: 100 },
  phone: { type: 'str', required: true, max: 40 },
  email: { type: 'str', required: true, max: 160 },
  address: { type: 'str', required: true, max: 200 },
  hours: { type: 'str', required: true, max: 200 },
  pricing_note: { type: 'str', max: 400, default: '' },
  discover_intro: { type: 'str', max: 400, default: '' }
};
router.get('/studio', async (req, res) => res.json(await content.settings()));
router.put('/studio', async (req, res) => {
  await content.saveSettings(parseOrThrow(STUDIO_SPEC, req.body));
  res.json(await content.settings());
});
router.post('/studio/hero', upload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an image first.', { image: 'Choose an image.' });
  const old = (await content.settings()).hero_image;
  const url = await saveImage(req.file);
  await content.saveSettings({ hero_image: url });
  await removeImage(old);
  res.json({ hero_image: url });
});
router.post('/studio/video', uploadVideo, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a video first.', { video: 'Choose a video.' });
  const old = (await content.settings()).team_video;
  const url = await saveVideo(req.file);
  await content.saveSettings({ team_video: url });
  await removeImage(old);
  res.json({ team_video: url });
});
router.delete('/studio/video', async (req, res) => {
  await removeImage((await content.settings()).team_video);
  await content.saveSettings({ team_video: '' });
  res.status(204).end();
});
router.delete('/studio/hero', async (req, res) => {
  await removeImage((await content.settings()).hero_image);
  await content.saveSettings({ hero_image: '' });
  res.status(204).end();
});

// ---- artists, works, FAQ: the same five operations each, so one small factory builds them
function dbError(e) {
  if (e.code === 'ER_DUP_ENTRY') return new HttpError(409, 'That value is already used.', { slug: 'Already used by another artist.' });
  if (e.code === 'ER_NO_REFERENCED_ROW_2') return new HttpError(422, 'Please check the highlighted fields.', { artist_id: 'That artist does not exist.' });
  return e;
}

function resource({ name, table, spec, image, order, check }) {
  const cols = Object.keys(spec).concat(image ? [image] : []);

  router.get(`/${name}`, async (req, res) => res.json((await db.query(`SELECT * FROM ${table} ORDER BY ${order}`))[0]));

  router.post(`/${name}`, upload.single('image'), async (req, res) => {
    const values = parseOrThrow(spec, req.body);
    if (check) check(values);
    if (image) values[image] = await saveImage(req.file);
    try {
      const [r] = await db.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => values[c] === undefined ? null : values[c]));
      res.status(201).json((await db.query(`SELECT * FROM ${table} WHERE id = ?`, [r.insertId]))[0][0]);
    } catch (e) { if (image) removeImage(values[image]); throw dbError(e); }
  });

  router.put(`/${name}/:id`, upload.single('image'), async (req, res) => {
    const id = intParam(req.params.id);
    const [[existing]] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!existing) throw new HttpError(404, 'Not found.');
    const values = parseOrThrow(spec, req.body);
    if (check) check(values);
    let newImage = null;
    if (image) {
      newImage = await saveImage(req.file);
      if (newImage) values[image] = newImage;
      else values[image] = req.body.remove_image === '1' ? null : existing[image];
    }
    try {
      await db.query(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => values[c] === undefined ? null : values[c]), id]);
    } catch (e) { removeImage(newImage); throw dbError(e); }
    if (image && existing[image] && values[image] !== existing[image]) await removeImage(existing[image]);
    res.json((await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0][0]);
  });

  router.delete(`/${name}/:id`, async (req, res) => {
    const id = intParam(req.params.id);
    const [[existing]] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!existing) throw new HttpError(404, 'Not found.');
    await db.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    if (image) await removeImage(existing[image]);
    res.status(204).end();
  });
}

resource({
  name: 'artists', table: 'artists', image: 'photo', order: 'sort_order, id',
  spec: {
    slug: { type: 'str', required: true, max: 60, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, message: 'Lower-case letters, digits and single hyphens only.' },
    name: { type: 'str', required: true, max: 100 },
    bio: { type: 'str', required: true, max: 1500 },
    specialty: { type: 'str', required: true, max: 160 },
    experience_years: { type: 'int', min: 0, max: 70, default: 0 },
    art_key: { type: 'enum', values: ['waves', 'rose', 'mandala'], default: 'waves' },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 },
    active: { type: 'bool', default: 1 }
  }
});
resource({
  name: 'works', table: 'works', image: 'image', order: 'sort_order, id',
  spec: {
    title: { type: 'str', required: true, max: 120 },
    artist_id: { type: 'int', min: 1 },
    description: { type: 'str', required: true, max: 1000 },
    art_key: { type: 'enum', values: ['irezumi', 'rose', 'mandala'], default: 'irezumi' },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 }
  }
});
resource({
  name: 'faqs', table: 'faqs', order: 'sort_order, id',
  spec: {
    question: { type: 'str', required: true, max: 255 },
    answer: { type: 'str', required: true, max: 2000 },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 }
  }
});
resource({
  name: 'reviews', table: 'reviews', order: 'sort_order, id DESC',
  spec: {
    name: { type: 'str', required: true, max: 100 },
    rating: { type: 'int', required: true, min: 1, max: 5, default: 5 },
    review: { type: 'str', required: true, max: 2000 },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 },
    active: { type: 'bool', default: 1 }
  }
});

// ---- pricing tiers and shop products (prices are typed in dollars and stored as cents)
resource({
  name: 'tiers', table: 'price_tiers', image: 'image', order: 'sort_order, id',
  spec: {
    name: { type: 'str', required: true, max: 40 },
    description: { type: 'str', max: 300, default: '' },
    price_cents: { type: 'money', required: true, min: 100, max: 10000000 },
    price_max_cents: { type: 'money', min: 100, max: 10000000 },
    deposit_cents: { type: 'money', required: true, min: 50, max: 10000000 },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 },
    active: { type: 'bool', default: 1 }
  },
  check(v) {
    const errs = {};
    if (v.price_max_cents != null && v.price_max_cents < v.price_cents) errs.price_max_cents = 'Must be at least the lowest price.';
    if (v.deposit_cents > v.price_cents) errs.deposit_cents = 'The deposit cannot be more than the price.';
    if (Object.keys(errs).length) throw new HttpError(422, 'Please check the highlighted fields.', errs);
  }
});
resource({
  name: 'products', table: 'products', image: 'image', order: 'sort_order, id',
  spec: {
    name: { type: 'str', required: true, max: 120 },
    category: { type: 'str', max: 40, default: 'General' },
    description: { type: 'str', max: 1000, default: '' },
    price_cents: { type: 'money', required: true, min: 50, max: 10000000 },
    stock: { type: 'int', min: 0, max: 100000 },
    sort_order: { type: 'int', min: 0, max: 9999, default: 0 },
    active: { type: 'bool', default: 1 }
  }
});

// ---- orders and deposits
const ORDER_STATUSES = orders.STATUSES;
router.get('/orders', async (req, res) => {
  const status = req.query.status || '', kind = req.query.kind || '';
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  if (kind && !['shop', 'deposit'].includes(kind)) throw new HttpError(400, 'Unknown kind.');
  const page = req.query.page ? intParam(req.query.page, 'page') : 1;
  const limit = Math.min(req.query.limit ? intParam(req.query.limit, 'limit') : 20, 100);
  res.json(await orders.list({ status, kind, q: String(req.query.q || '').slice(0, 80), page, limit }));
});
router.patch('/orders/:id', async (req, res) => {
  const { status } = parseOrThrow({ status: { type: 'enum', required: true, values: ORDER_STATUSES } }, req.body);
  res.json(await orders.adminSetStatus(intParam(req.params.id), status));
});
router.delete('/orders/:id', async (req, res) => { await orders.remove(intParam(req.params.id)); res.status(204).end(); });

// ---- ways to pay
router.get('/payments', async (req, res) => {
  const [rows] = await db.query('SELECT method, label, enabled, account, instructions FROM payment_methods ORDER BY sort_order');
  res.json({ methods: rows, stripe_configured: pay.stripeConfigured(), webhook_configured: !!(process.env.STRIPE_WEBHOOK_SECRET || '').trim() });
});
router.put('/payments/:method', async (req, res) => {
  const key = req.params.method;
  const [[row]] = await db.query('SELECT method FROM payment_methods WHERE method = ?', [key]);
  if (!row) throw new HttpError(404, 'Unknown payment method.');
  const v = parseOrThrow({
    label: { type: 'str', required: true, max: 60 },
    enabled: { type: 'bool', default: 0 },
    account: { type: 'str', max: 200, default: '' },
    instructions: { type: 'str', max: 600, default: '' }
  }, req.body);
  if (key === 'bitcoin' && v.account && !pay.BTC_ADDRESS.test(v.account)) throw new HttpError(422, 'Please check the highlighted fields.', { account: 'That does not look like a Bitcoin address. Copy it again from your wallet.' });
  if (v.enabled && key !== 'card' && !v.account) throw new HttpError(422, 'Please check the highlighted fields.', { account: 'Enter where customers should send the money before switching this on.' });
  if (v.enabled && key === 'card' && !pay.stripeConfigured()) throw new HttpError(422, 'Card payments need a Stripe key in the .env file first. See UPDATE.md.', { enabled: 'Add STRIPE_SECRET_KEY to .env first.' });
  await db.query('UPDATE payment_methods SET label = ?, enabled = ?, account = ?, instructions = ? WHERE method = ?', [v.label, v.enabled, v.account, v.instructions, key]);
  res.json((await db.query('SELECT method, label, enabled, account, instructions FROM payment_methods WHERE method = ?', [key]))[0][0]);
});

module.exports = router;
