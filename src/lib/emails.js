// The three emails customers receive: booking received, payment reserved (waiting for payment), payment received.
const mail = require('./mailer');
const pay = require('./payments');
const { usd } = require('./money');
const content = require('../models/content');
const db = require('../../config/db');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Each email is written once as a list of blocks, then rendered as plain text and as simple HTML.
// block: { p: 'paragraph' } | { h: 'heading' } | { rows: [[label, value], ...] } | { code: 'REF' } | { link: [label, url] }
function render(studio, preheader, blocks) {
  const name = studio.studio_name || 'Ink Nation';
  const text = blocks.map(b => b.p ? b.p : b.h ? b.h.toUpperCase() : b.code ? `Your code: ${b.code}` : b.link ? `${b.link[0]}: ${b.link[1]}` : b.rows.map(r => `${r[0]}: ${r[1]}`).join('\n')).join('\n\n')
    + `\n\n--\n${name}\n${[studio.phone, studio.email, studio.address].filter(Boolean).join(' · ')}`;
  const body = blocks.map(b => {
    if (b.p) return `<p style="margin:0 0 14px;line-height:1.55">${esc(b.p).replace(/\n/g, '<br>')}</p>`;
    if (b.h) return `<h2 style="margin:22px 0 8px;font-size:18px">${esc(b.h)}</h2>`;
    if (b.code) return `<p style="margin:0 0 14px"><span style="display:inline-block;background:#0d0d0d;color:#e1e1e1;padding:9px 12px;border-radius:2px;font:600 18px monospace;letter-spacing:.04em">${esc(b.code)}</span></p>`;
    if (b.link) return `<p style="margin:0 0 14px"><a href="${esc(b.link[1])}" style="display:inline-block;background:#0d0d0d;color:#e1e1e1;padding:12px 18px;border-radius:2px;text-decoration:none;font-weight:600">${esc(b.link[0])}</a></p>`;
    return `<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 14px">${b.rows.map(r => `<tr><td style="padding:7px 10px 7px 0;border-bottom:1px solid #ddd;color:#555;vertical-align:top;width:38%">${esc(r[0])}</td><td style="padding:7px 0;border-bottom:1px solid #ddd;font-weight:600;word-break:break-all">${esc(r[1])}</td></tr>`).join('')}</table>`;
  }).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#efefef;font-family:Helvetica,Arial,sans-serif;color:#0d0d0d"><span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" style="background:#efefef"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" style="max-width:560px;width:100%;background:#fff;border-radius:4px">
<tr><td style="background:#0d0d0d;color:#e1e1e1;padding:18px 24px;font:800 20px Helvetica,Arial,sans-serif;letter-spacing:-.02em">${esc(name.toUpperCase())}</td></tr>
<tr><td style="padding:24px;font-size:14px">${body}</td></tr>
<tr><td style="padding:16px 24px;background:#f6f6f6;color:#666;font-size:12px;line-height:1.5">${esc([studio.phone, studio.email, studio.address].filter(Boolean).join(' · '))}</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

const itemRows = o => o.items.map(i => [(i.qty > 1 ? i.qty + ' × ' : '') + i.name, usd(i.unit_cents * i.qty)]).concat([['Total', usd(o.total_cents)]]);
async function ctx() { const studio = await content.settings(); return { studio, url: pay.appUrl(), name: studio.studio_name || 'Ink Nation' }; }
const deliver = (studio, to, subject, preheader, blocks) => mail.send({ to, subject, replyTo: studio.email || undefined, ...render(studio, preheader, blocks) });

// 1. A booking request was made.
async function bookingReceived(b) {
  const { studio, url, name } = await ctx();
  const blocks = [
    { p: `Hi ${b.name}, thank you for your booking request at ${name}. We have it, and the studio will get in touch to confirm your date.` },
    { code: b.reference },
    { rows: [['Size', b.piece], ['Artist', b.artist_name || 'To be chosen with you'], ['Preferred date', b.preferred_date]] }
  ];
  if (b.deposit_cents > 0 && !b.deposit_paid) {
    blocks.push({ h: `Secure it with a ${usd(b.deposit_cents)} deposit` });
    blocks.push({ p: `The deposit is taken off your final price. You can pay it online with a card, Apple Pay, Zelle, Chime or Bitcoin: open the booking form, choose "Already sent a request? Check its status", enter your code and this email address, and press "Pay deposit now".` });
    blocks.push({ link: ['Pay your deposit', `${url}/#book`] });
  }
  blocks.push({ p: 'You can also use your code and email on the same page to check or cancel your request.' });
  return deliver(studio, b.email, `Booking request received (${b.reference}) · ${name}`, `We received your booking request ${b.reference}.`, blocks);
}

// 2. A payment was reserved and is waiting for the customer to pay (the stock or the deposit is held for 24 hours).
async function awaitingPayment(order) {
  const { studio, url, name } = await ctx();
  const view = await require('./checkout').view(order); // the same payment details the customer sees on screen
  const p = view.payment, what = order.kind === 'deposit' ? 'booking deposit' : 'order';
  const blocks = [
    { p: `Hi ${order.name}, we have reserved your ${what} at ${name}. It is not paid yet: please complete the payment within 24 hours, or the reservation is released.` },
    { code: order.reference },
    { rows: itemRows(order) }
  ];
  if (p && p.type === 'redirect') {
    blocks.push({ h: 'Pay by card' }); blocks.push({ p: 'Use the secure payment page. Apple Pay and Google Pay are offered there on devices that support them.' }); blocks.push({ link: ['Pay now', p.url] });
  } else if (p && p.type === 'manual') {
    blocks.push({ h: `Pay with ${p.label}` });
    blocks.push({ rows: [['Send to', p.account], ['Exact amount', usd(p.amount_cents)], ['Write in the note', p.memo]] });
    if (p.instructions) blocks.push({ p: p.instructions });
  } else if (p && p.type === 'bitcoin') {
    blocks.push({ h: 'Pay with Bitcoin' });
    blocks.push({ rows: [['Exact amount', `${p.btc} BTC (about ${usd(p.amount_cents)})`], ['Send to address', p.address], ['Rate used', `1 BTC = ${usd(Math.round(p.rate_usd * 100))}`]] });
  }
  if (p && p.type !== 'redirect') {
    blocks.push({ p: 'After you have sent the money, press "I have sent the payment" so the studio knows to look for it. Open the page below, enter your code and this email address.' });
    blocks.push({ link: ['Open my order', `${url}/discover.html#lookup`] });
  }
  return deliver(studio, order.email, `Payment reserved: ${order.reference} is waiting for your payment · ${name}`, `Your ${what} is reserved. Complete the payment to confirm it.`, blocks);
}

// 3. The payment was confirmed (by Stripe, or by the studio).
async function paymentReceived(orderId) {
  const [[o]] = await db.query('SELECT o.*, b.reference AS booking_reference FROM orders o LEFT JOIN bookings b ON b.id = o.booking_id WHERE o.id = ?', [orderId]);
  if (!o) return;
  const [items] = await db.query('SELECT name, unit_cents, qty FROM order_items WHERE order_id = ? ORDER BY id', [orderId]);
  o.items = items;
  const { studio, name } = await ctx();
  const blocks = [
    { p: `Hi ${o.name}, we have received your payment of ${usd(o.total_cents)}. Thank you!` },
    { code: o.reference },
    { rows: itemRows(o) },
    { p: o.kind === 'deposit'
      ? `Your deposit for booking ${o.booking_reference || ''} is paid. The studio will confirm your date with you.`
      : 'The studio will contact you about collecting or delivering your order. Keep this code if you need to check it.' }
  ];
  return deliver(studio, o.email, `Payment received: ${o.reference} · ${name}`, `We received your payment of ${usd(o.total_cents)}.`, blocks);
}

module.exports = { bookingReceived, awaitingPayment, paymentReceived, render };
