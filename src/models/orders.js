// Orders cover shop purchases AND booking deposits. Stock is reserved when an order is placed
// and given back if the order is cancelled, all inside transactions so two buyers cannot take the last item.
const crypto = require('crypto');
const db = require('../../config/db');
const { HttpError } = require('../lib/errors');
const { isDuplicate } = require('../lib/dbErrors');

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newReference() {
  const b = crypto.randomBytes(6);
  let s = 'ORD-';
  for (let i = 0; i < 6; i++) s += CHARS[b[i] % CHARS.length];
  return s;
}
const OPEN = ['awaiting_payment', 'payment_submitted'];
const STATUSES = ['awaiting_payment', 'payment_submitted', 'paid', 'fulfilled', 'cancelled'];
const MAX_LINES = 20, MAX_QTY = 20;

async function insertOrder(conn, o, items) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const reference = newReference();
    try {
      const [r] = await conn.query(
        `INSERT INTO orders (reference, kind, booking_id, name, email, phone, note, total_cents, method) VALUES (?,?,?,?,?,?,?,?,?)`,
        [reference, o.kind, o.booking_id || null, o.name, o.email, o.phone || '', o.note || '', o.total_cents, o.method]);
      for (const it of items) await conn.query('INSERT INTO order_items (order_id, product_id, name, unit_cents, qty) VALUES (?,?,?,?,?)', [r.insertId, it.product_id || null, it.name, it.unit_cents, it.qty]);
      return r.insertId;
    } catch (e) { if (!isDuplicate(e) || attempt === 5) throw e; }
  }
}

async function getById(id, conn = db) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  const [items] = await conn.query('SELECT product_id, name, unit_cents, qty FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return { ...order, items };
}

// lines: [{ product_id, qty }]. Prices always come from the database, never from the browser.
async function createShopOrder(customer, lines, method) {
  if (!Array.isArray(lines) || !lines.length) throw new HttpError(422, 'Your cart is empty.', { items: 'Add at least one product.' });
  if (lines.length > MAX_LINES) throw new HttpError(422, `Please order at most ${MAX_LINES} different products at a time.`);
  const merged = new Map();
  for (const l of lines) {
    const id = Number(l && l.product_id), qty = Number(l && l.qty);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new HttpError(422, `Each quantity must be between 1 and ${MAX_QTY}.`);
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [...merged.keys()].sort((a, b) => a - b);
    const [rows] = await conn.query(`SELECT id, name, price_cents, stock, active FROM products WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
    const byId = new Map(rows.map(r => [r.id, r]));
    const items = []; let total = 0;
    for (const id of ids) {
      const p = byId.get(id), qty = merged.get(id);
      if (!p || !p.active) throw new HttpError(409, 'One of the products in your cart is no longer available. Please review your cart.');
      if (p.stock !== null && p.stock < qty) throw new HttpError(409, p.stock === 0 ? `${p.name} is sold out.` : `Only ${p.stock} of ${p.name} left. Please lower the quantity.`);
      items.push({ product_id: p.id, name: p.name, unit_cents: p.price_cents, qty });
      total += p.price_cents * qty;
      if (p.stock !== null) await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, p.id]);
    }
    const id = await insertOrder(conn, { kind: 'shop', ...customer, total_cents: total, method }, items);
    await conn.commit();
    return await getById(id, conn);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function createDepositOrder(booking, method) {
  if (!booking.deposit_cents) throw new HttpError(409, 'This booking has no deposit to pay.');
  if (!['pending', 'confirmed'].includes(booking.status)) throw new HttpError(409, `This booking is ${booking.status}, so a deposit cannot be paid.`);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[b]] = await conn.query('SELECT id, deposit_paid FROM bookings WHERE id = ?', [booking.id]);
    if (b.deposit_paid) throw new HttpError(409, 'The deposit for this booking is already paid. Thank you!');
    const [[paid]] = await conn.query("SELECT COUNT(*) n FROM orders WHERE booking_id = ? AND kind = 'deposit' AND status = 'payment_submitted'", [booking.id]);
    if (paid.n) throw new HttpError(409, 'You already told us you sent this deposit. The studio is checking it now.');
    // An earlier unpaid attempt (for example a different method) is replaced by this one.
    await conn.query("UPDATE orders SET status = 'cancelled' WHERE booking_id = ? AND kind = 'deposit' AND status = 'awaiting_payment'", [booking.id]);
    const id = await insertOrder(conn, {
      kind: 'deposit', booking_id: booking.id, name: booking.name, email: booking.email, phone: booking.phone,
      total_cents: booking.deposit_cents, method
    }, [{ name: `Deposit for ${booking.piece} (${booking.reference})`, unit_cents: booking.deposit_cents, qty: 1 }]);
    await conn.commit();
    return await getById(id, conn);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function findForVisitor(reference, email) {
  const [[row]] = await db.query('SELECT id FROM orders WHERE reference = ? AND email = ?', [String(reference).toUpperCase(), String(email || '').toLowerCase()]);
  return row ? getById(row.id) : null;
}

async function attachPayment(id, fields) {
  const cols = Object.keys(fields);
  await db.query(`UPDATE orders SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => fields[c]), id]);
}

// The one place where "paid" happens, whoever noticed the payment (Stripe, or the studio by hand).
// Safe to call twice.
async function markPaid(id, conn = db) {
  const [r] = await conn.query("UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('awaiting_payment','payment_submitted')", [id]);
  if (r.affectedRows) {
    await conn.query("UPDATE bookings SET deposit_paid = 1 WHERE id = (SELECT booking_id FROM orders WHERE id = ? AND kind = 'deposit')", [id]);
    // Tell the customer and the studio, in the background (required here, not at the top, because emails.js also needs this file's database).
    const mail = require('../lib/mailer');
    mail.later(() => require('../lib/emails').paymentReceived(id));
    mail.later(() => require('../lib/emails').adminPaymentReceived(id));
  }
  return r.affectedRows > 0;
}

// Cancels an order and puts its items back in stock. Does nothing if it is already cancelled.
async function cancel(id, { allowFrom = STATUSES } = {}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[o]] = await conn.query('SELECT id, status, kind, booking_id FROM orders WHERE id = ?', [id]);
    if (!o) throw new HttpError(404, 'Order not found.');
    if (o.status === 'cancelled') { await conn.commit(); return false; }
    if (!allowFrom.includes(o.status)) throw new HttpError(409, 'This order can no longer be cancelled here. Please contact the studio.');
    const [items] = await conn.query('SELECT product_id, qty FROM order_items WHERE order_id = ?', [id]);
    for (const it of items) if (it.product_id) await conn.query('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', [it.qty, it.product_id]);
    await conn.query("UPDATE orders SET status = 'cancelled', paid_at = NULL WHERE id = ?", [id]);
    if (o.kind === 'deposit' && o.booking_id) {
      const [[other]] = await conn.query("SELECT COUNT(*) n FROM orders WHERE booking_id = ? AND kind = 'deposit' AND status IN ('paid','fulfilled') AND id <> ?", [o.booking_id, id]);
      if (!other.n) await conn.query('UPDATE bookings SET deposit_paid = 0 WHERE id = ?', [o.booking_id]);
    }
    await conn.commit();
    return true;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function submitted(id, paymentNote) {
  const [r] = await db.query("UPDATE orders SET status = 'payment_submitted', payment_note = ? WHERE id = ? AND status = 'awaiting_payment' AND method <> 'card'", [paymentNote || '', id]);
  return r.affectedRows > 0;
}

// Orders nobody paid within a day give their stock back.
async function expireStale() {
  const [rows] = await db.query("SELECT id FROM orders WHERE status = 'awaiting_payment' AND created_at < datetime('now','-1 day') LIMIT 100");
  for (const r of rows) await cancel(r.id, { allowFrom: ['awaiting_payment'] }).catch(() => {});
  return rows.length;
}

// ---- admin
async function list({ status, kind, q, page, limit }) {
  const where = [], params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (kind) { where.push('o.kind = ?'); params.push(kind); }
  if (q) { where.push('(o.name LIKE ? OR o.email LIKE ? OR o.reference LIKE ?)'); const l = `%${q}%`; params.push(l, l, l); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM orders o ${w}`, params);
  const [data] = await db.query(
    `SELECT o.*, b.reference AS booking_reference FROM orders o LEFT JOIN bookings b ON b.id = o.booking_id ${w}
     ORDER BY (o.status = 'payment_submitted') DESC, o.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  if (data.length) {
    const [items] = await db.query(`SELECT order_id, name, unit_cents, qty FROM order_items WHERE order_id IN (${data.map(() => '?').join(',')}) ORDER BY id`, data.map(d => d.id));
    data.forEach(d => { d.items = items.filter(i => i.order_id === d.id); });
  }
  return { data, total, page, limit };
}

async function adminSetStatus(id, status) {
  const o = await getById(id);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.status === status) return o;
  if (o.status === 'cancelled') throw new HttpError(409, 'A cancelled order cannot be reopened, because its stock was given back. Ask the customer to order again.');
  if (status === 'cancelled') { await cancel(id); return getById(id); }
  if (status === 'paid' || status === 'fulfilled') {
    if (OPEN.includes(o.status)) await markPaid(id);
    if (status === 'fulfilled') await db.query("UPDATE orders SET status = 'fulfilled' WHERE id = ?", [id]);
    else await db.query("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'fulfilled'", [id]);
    return getById(id);
  }
  // going back to "awaiting" or "submitted" from paid: undo the payment
  await db.query('UPDATE orders SET status = ?, paid_at = NULL WHERE id = ?', [status, id]);
  if (o.kind === 'deposit' && o.booking_id) await db.query('UPDATE bookings SET deposit_paid = 0 WHERE id = ?', [o.booking_id]);
  return getById(id);
}

async function remove(id) {
  const o = await getById(id);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.status !== 'cancelled') throw new HttpError(409, 'Cancel the order first. That gives the stock back. Then it can be deleted.');
  await db.query('DELETE FROM orders WHERE id = ?', [id]);
}

async function stats() {
  const [[a]] = await db.query("SELECT COUNT(*) n FROM orders WHERE status = 'payment_submitted'");
  const [[b]] = await db.query("SELECT COUNT(*) n FROM orders WHERE status = 'paid' AND kind = 'shop'");
  const [[c]] = await db.query("SELECT COALESCE(SUM(total_cents),0) s FROM orders WHERE status IN ('paid','fulfilled')");
  return { payments_to_check: a.n, orders_to_fulfil: b.n, received_cents: Number(c.s) };
}

module.exports = { STATUSES, OPEN, createShopOrder, createDepositOrder, findForVisitor, getById, attachPayment, markPaid, cancel, submitted, expireStale, list, adminSetStatus, remove, stats };
