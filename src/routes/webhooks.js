// Stripe tells us here when a card payment succeeded. The signature is checked on the raw request body first.
const pay = require('../lib/payments');
const checkout = require('../lib/checkout');
const db = require('../../config/db');
const orders = require('../models/orders');

module.exports = async function stripeWebhook(req, res) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  if (!pay.verifyStripeSignature(req.body, req.get('stripe-signature'), secret)) return res.status(400).json({ error: 'Invalid signature.' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid payload.' }); }
  const s = event && event.data && event.data.object;
  const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'];
  if (s && handled.includes(event.type) && s.client_reference_id) {
    const [[row]] = await db.query('SELECT id FROM orders WHERE reference = ? AND stripe_session_id = ?', [String(s.client_reference_id), String(s.id)]);
    if (row) await checkout.applyStripeSession(await orders.getById(row.id), s);
  }
  res.json({ received: true });
};
