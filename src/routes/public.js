const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../config/db');
const content = require('../models/content');
const bookings = require('../models/bookings');
const { HttpError } = require('../lib/errors');
const { parse, parseOrThrow, intParam } = require('../lib/fields');
const { upload, saveImage, removeImage } = require('../lib/images');
const { validateBooking, today, plusDays, realDate } = require('../lib/bookingRules');
const shop = require('../models/shop');
const mail = require('../lib/mailer');
const emails = require('../lib/emails');

const router = express.Router();
const limiter = (limit, windowMs) => rateLimit({
  windowMs, limit: process.env.NODE_ENV === 'test' ? 100000 : limit,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests. Please try again in a little while.' })
});

// ---- content shown on the website
router.get('/studio', async (req, res) => { const s = await content.settings(); res.json(s); });
router.get('/artists', async (req, res) => res.json(await content.artists(true)));
router.get('/works', async (req, res) => res.json(await content.works()));
router.get('/faq', async (req, res) => res.json(await content.faqs()));
router.get('/reviews', async (req, res) => res.json(await content.reviews()));

// ---- booking
router.get('/availability', async (req, res) => {
  const artistId = intParam(req.query.artistId, 'artistId');
  const from = req.query.from || today();
  const to = req.query.to || plusDays(120);
  if (!realDate(from) || !realDate(to) || from > to) throw new HttpError(400, 'from and to must be valid dates (YYYY-MM-DD), from first.');
  res.json({ artistId, from, to, full: await bookings.fullDates(artistId, from, to) });
});

// A visitor never sees other people's data: the booking needs BOTH its reference and the email used.
const publicView = b => ({
  reference: b.reference, name: b.name, piece: b.piece, artist: b.artist_name || null,
  colour_mode: b.colour_mode, date: b.preferred_date, status: b.status,
  deposit_cents: b.deposit_cents, deposit_paid: !!b.deposit_paid
});

router.post('/bookings', limiter(15, 60 * 60 * 1000), upload.single('reference_image'), async (req, res) => {
  const { errors, clean } = validateBooking(req.body);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please check the highlighted fields.', errors);
  if (clean.tier_id) {
    const tier = await shop.tier(clean.tier_id);
    if (!tier) throw new HttpError(422, 'Please check the highlighted fields.', { tier_id: 'That size is not available.' });
    clean.piece = tier.name; clean.deposit_cents = tier.deposit_cents;
  }
  clean.reference_image = await saveImage(req.file);
  try {
    const row = await bookings.create(clean);
    mail.later(() => emails.bookingReceived(row));
    res.status(201).json(publicView(row));
  } catch (e) {
    removeImage(clean.reference_image);
    throw e;
  }
});

router.get('/bookings/:reference', limiter(60, 60 * 60 * 1000), async (req, res) => {
  const row = await bookings.findForVisitor(req.params.reference, req.query.email);
  if (!row) throw new HttpError(404, 'No booking matches that reference and email.');
  res.json(publicView(row));
});

router.post('/bookings/:reference/cancel', limiter(20, 60 * 60 * 1000), async (req, res) => {
  const row = await bookings.cancelForVisitor(req.params.reference, req.body && req.body.email);
  res.json(publicView(row));
});

// ---- "Have a question?"
router.post('/inquiries', limiter(10, 60 * 60 * 1000), async (req, res) => {
  const v = parseOrThrow({
    name: { type: 'str', required: true, min: 2, max: 100 },
    email: { type: 'str', required: true, max: 160, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address.' },
    question: { type: 'str', required: true, min: 5, max: 2000 }
  }, req.body);
  await db.query('INSERT INTO inquiries (name, email, question) VALUES (?,?,?)', [v.name, v.email.toLowerCase(), v.question]);
  res.status(201).json({ ok: true });
});

module.exports = router;
