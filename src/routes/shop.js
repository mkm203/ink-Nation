const express = require('express');
const rateLimit = require('express-rate-limit');
const shop = require('../models/shop');
const orders = require('../models/orders');
const bookings = require('../models/bookings');
const checkout = require('../lib/checkout');
const mail = require('../lib/mailer');
const emails = require('../lib/emails');
const { HttpError } = require('../lib/errors');
const { parseOrThrow } = require('../lib/fields');

const router = express.Router();
const limiter = (limit, windowMs) => rateLimit({
  windowMs, limit: process.env.NODE_ENV === 'test' ? 100000 : limit,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests. Please try again in a little while.' })
});
const EMAIL = { type: 'str', required: true, max: 160, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address.' };
const METHOD = { type: 'enum', required: true, values: ['card', 'zelle', 'chime', 'bitcoin'] };

// ---- what the Discover page shows
router.get('/tiers', async (req, res) => res.json(await shop.tiers(true)));
router.get('/products', async (req, res) => res.json(await shop.products()));
router.get('/payment-methods', async (req, res) => {
  const all = await shop.methods();
  res.json(all.filter(checkout.usable).map(m => ({ method: m.method, label: m.label, instructions: m.instructions })));
});

// ---- buying products
router.post('/orders', limiter(20, 60 * 60 * 1000), async (req, res) => {
  const v = parseOrThrow({
    name: { type: 'str', required: true, min: 2, max: 100 },
    email: EMAIL,
    phone: { type: 'str', max: 30, default: '', pattern: /^\+?[0-9][0-9\s().-]{6,28}$/, message: 'Enter a valid phone number, for example +1 555 123 4567.' },
    note: { type: 'str', max: 500, default: '' },
    method: METHOD
  }, req.body);
  await checkout.requireUsable(v.method);
  const lines = ((req.body && req.body.items) || []).map(i => ({ product_id: i && i.product_id, qty: i && i.qty }));
  await orders.expireStale().catch(() => {});
  const order = await orders.createShopOrder({ name: v.name, email: v.email.toLowerCase(), phone: v.phone, note: v.note }, lines, v.method);
  const started = await checkout.startPayment(order);
  mail.later(() => emails.awaitingPayment(started));
  res.status(201).json(await checkout.view(started));
});

// ---- paying a booking deposit
router.post('/bookings/:reference/deposit', limiter(20, 60 * 60 * 1000), async (req, res) => {
  const v = parseOrThrow({ email: EMAIL, method: METHOD }, req.body);
  const booking = await bookings.findForVisitor(req.params.reference, v.email);
  if (!booking) throw new HttpError(404, 'No booking matches that reference and email.');
  await checkout.requireUsable(v.method);
  const order = await orders.createDepositOrder(booking, v.method);
  const started = await checkout.startPayment(order);
  mail.later(() => emails.awaitingPayment(started));
  res.status(201).json(await checkout.view(started));
});

// ---- looking at, confirming and cancelling an order (reference AND email are needed)
async function mine(req) {
  const email = (req.method === 'GET' ? req.query.email : req.body && req.body.email) || '';
  const o = await orders.findForVisitor(req.params.reference, email);
  if (!o) throw new HttpError(404, 'No order matches that code and email.');
  return o;
}
router.get('/orders/:reference', limiter(60, 60 * 60 * 1000), async (req, res) => {
  res.json(await checkout.view(await checkout.syncCard(await mine(req))));
});
router.post('/orders/:reference/submitted', limiter(30, 60 * 60 * 1000), async (req, res) => {
  const o = await mine(req);
  if (o.method === 'card') throw new HttpError(409, 'Card payments are confirmed automatically. Nothing to send here.');
  const { payment_note } = parseOrThrow({ payment_note: { type: 'str', max: 200, default: '' } }, req.body);
  if (o.status === 'awaiting_payment') await orders.submitted(o.id, payment_note);
  else if (o.status !== 'payment_submitted') throw new HttpError(409, `This order is ${o.status.replace('_', ' ')}.`);
  res.json(await checkout.view(await orders.getById(o.id)));
});
router.post('/orders/:reference/cancel', limiter(30, 60 * 60 * 1000), async (req, res) => {
  const o = await mine(req);
  await orders.cancel(o.id, { allowFrom: ['awaiting_payment'] });
  res.json(await checkout.view(await orders.getById(o.id)));
});

module.exports = router;
