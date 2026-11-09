// Talking to payment providers. Nothing here stores card data: cards are handled by Stripe's own page.
const crypto = require('crypto');
const { HttpError } = require('./errors');

const env = k => (process.env[k] || '').trim();
const stripeBase = () => env('STRIPE_API_BASE') || 'https://api.stripe.com';
const stripeConfigured = () => /^sk_(test|live)_/.test(env('STRIPE_SECRET_KEY')) || (env('STRIPE_API_BASE') && !!env('STRIPE_SECRET_KEY'));
const appUrl = () => (env('APP_URL') || env('RENDER_EXTERNAL_URL') || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

async function stripe(method, path, form) {
  let res;
  try {
    res = await fetch(stripeBase() + path, {
      method,
      headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    console.error('Stripe unreachable:', e.message);
    throw new HttpError(502, 'Card payment is unavailable right now. Please choose another method or try again later.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe error:', res.status, json && json.error && json.error.message);
    throw new HttpError(502, 'Card payment is unavailable right now. Please choose another method or try again later.');
  }
  return json;
}

// A hosted Stripe Checkout page. Apple Pay and Google Pay appear on it automatically for devices that support them
// (once they are switched on in the Stripe dashboard), next to normal card payment.
async function createCheckoutSession(order, items, brand) {
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', `${appUrl()}/discover.html?order=${encodeURIComponent(order.reference)}&back=1`);
  f.set('cancel_url', `${appUrl()}/discover.html?order=${encodeURIComponent(order.reference)}&back=1`);
  f.set('client_reference_id', order.reference);
  f.set('customer_email', order.email);
  f.set('metadata[reference]', order.reference);
  f.set('payment_intent_data[metadata][reference]', order.reference);
  f.set('payment_intent_data[description]', `${brand} ${order.reference}`);
  items.forEach((it, i) => {
    f.set(`line_items[${i}][quantity]`, String(it.qty));
    f.set(`line_items[${i}][price_data][currency]`, 'usd');
    f.set(`line_items[${i}][price_data][unit_amount]`, String(it.unit_cents));
    f.set(`line_items[${i}][price_data][product_data][name]`, it.name.slice(0, 120));
  });
  const s = await stripe('POST', '/v1/checkout/sessions', f);
  return { id: s.id, url: s.url };
}
const fetchCheckoutSession = id => stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(id));

// Stripe signs every webhook. Only a request with a valid signature may mark an order as paid.
function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const parts = {};
  for (const p of String(header).split(',')) { const i = p.indexOf('='); if (i > 0) (parts[p.slice(0, i).trim()] = parts[p.slice(0, i).trim()] || []).push(p.slice(i + 1).trim()); }
  const t = Number((parts.t || [])[0]);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  return (parts.v1 || []).some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

// ---- Bitcoin: the price in dollars is turned into bitcoin with a live rate at the moment of the order.
let rateCache = { at: 0, rate: 0 };
const RATE_SOURCES = () => env('BTC_RATE_URL') ? [env('BTC_RATE_URL')] : [
  'https://api.coinbase.com/v2/prices/BTC-USD/spot',
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
];
function readRate(j) {
  const v = j && j.data && j.data.amount !== undefined ? j.data.amount : j && j.bitcoin ? j.bitcoin.usd : j && j.rate;
  const n = Number(v);
  return Number.isFinite(n) && n > 1000 && n < 10000000 ? n : 0;
}
async function btcRate() {
  if (rateCache.rate && Date.now() - rateCache.at < 60000) return rateCache.rate;
  for (const url of RATE_SOURCES()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const rate = r.ok ? readRate(await r.json()) : 0;
      if (rate) { rateCache = { at: Date.now(), rate }; return rate; }
    } catch { /* try the next source */ }
  }
  throw new HttpError(503, 'Bitcoin prices cannot be loaded right now. Please choose another method or try again in a minute.');
}
// Rounded UP to the next satoshi so the studio never receives slightly less than the price.
async function btcQuote(totalCents) {
  const rate = await btcRate();
  const rc = BigInt(Math.round(rate * 100)); // dollars per bitcoin, in cents, so everything below is exact integer maths
  const sats = Number((BigInt(totalCents) * 100000000n + rc - 1n) / rc);
  return { rate, sats };
}
const resetRateCache = () => { rateCache = { at: 0, rate: 0 }; };
const btcText = sats => (sats / 1e8).toFixed(8);
const BTC_ADDRESS = /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

module.exports = { stripeConfigured, createCheckoutSession, fetchCheckoutSession, verifyStripeSignature, btcQuote, resetRateCache, btcText, BTC_ADDRESS, appUrl };
