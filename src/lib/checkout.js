// Starting a payment for an order, describing it to the customer, and reacting to Stripe.
const QRCode = require('qrcode');
const { HttpError } = require('./errors');
const pay = require('./payments');
const orders = require('../models/orders');
const shop = require('../models/shop');
const content = require('../models/content');

const MANUAL = ['zelle', 'chime'];

// A method may be used only if the studio switched it on AND it can really work.
function usable(m) {
  if (!m || !m.enabled) return false;
  return m.method === 'card' ? pay.stripeConfigured() : !!m.account;
}
async function requireUsable(key) {
  const m = await shop.method(key);
  if (!usable(m)) throw new HttpError(422, 'That payment method is not available. Please choose another.', { method: 'Not available.' });
  return m;
}

// Gets the payment ready after the order exists. If that fails, the order is cancelled so the stock goes back.
async function startPayment(order) {
  try {
    const m = await shop.method(order.method);
    if (order.method === 'card') {
      const { studio_name } = await content.settings();
      const s = await pay.createCheckoutSession(order, order.items, studio_name || 'Ink Nation');
      await orders.attachPayment(order.id, { stripe_session_id: s.id, pay_url: s.url });
    } else if (order.method === 'bitcoin') {
      const q = await pay.btcQuote(order.total_cents);
      await orders.attachPayment(order.id, { btc_sats: q.sats, btc_rate: q.rate, pay_to: m.account });
    } else {
      await orders.attachPayment(order.id, { pay_to: m.account });
    }
  } catch (e) {
    await orders.cancel(order.id).catch(() => {});
    throw e;
  }
  return orders.getById(order.id);
}

// Everything a customer may see about their own order.
async function view(o) {
  const out = {
    reference: o.reference, kind: o.kind, status: o.status, method: o.method, total_cents: o.total_cents,
    name: o.name, created_at: o.created_at, paid_at: o.paid_at,
    items: o.items.map(i => ({ name: i.name, qty: i.qty, unit_cents: i.unit_cents })), payment: null
  };
  if (!orders.OPEN.includes(o.status)) return out;
  const m = await shop.method(o.method);
  const submitted = o.status === 'payment_submitted';
  if (o.method === 'card') out.payment = { type: 'redirect', url: o.pay_url, submitted: false };
  else if (MANUAL.includes(o.method)) {
    out.payment = { type: 'manual', label: m ? m.label : o.method, account: o.pay_to, instructions: m ? m.instructions : '', amount_cents: o.total_cents, memo: o.reference, submitted };
  } else if (o.method === 'bitcoin' && o.btc_sats) {
    const btc = pay.btcText(Number(o.btc_sats));
    const uri = `bitcoin:${o.pay_to}?amount=${btc}&label=${encodeURIComponent('Ink Nation ' + o.reference)}`;
    out.payment = {
      type: 'bitcoin', label: 'Bitcoin', address: o.pay_to, btc, rate_usd: Number(o.btc_rate), uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 260 }),
      instructions: m ? m.instructions : '', amount_cents: o.total_cents, memo: o.reference, submitted
    };
  }
  return out;
}

// Applies what Stripe says about a Checkout session to our order. Used by the webhook and by the "check my payment" lookup.
async function applyStripeSession(order, s) {
  if (!order || order.method !== 'card') return order;
  if (s.payment_status === 'paid') {
    // Never trust "paid" for a different amount or currency than the order we created.
    if (s.amount_total === order.total_cents && String(s.currency).toLowerCase() === 'usd') await orders.markPaid(order.id);
    else console.error(`Stripe amount mismatch for ${order.reference}: ${s.amount_total} ${s.currency} vs ${order.total_cents}`);
  } else if (s.status === 'expired') await orders.cancel(order.id, { allowFrom: ['awaiting_payment'] }).catch(() => {});
  return orders.getById(order.id);
}
async function syncCard(order) {
  if (order.method !== 'card' || order.status !== 'awaiting_payment' || !order.stripe_session_id || !pay.stripeConfigured()) return order;
  try { return await applyStripeSession(order, await pay.fetchCheckoutSession(order.stripe_session_id)); }
  catch { return order; }
}

module.exports = { usable, requireUsable, startPayment, view, applyStripeSession, syncCard };
