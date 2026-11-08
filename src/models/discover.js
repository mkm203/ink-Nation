const db = require('../../config/db');
const { HttpError } = require('../lib/errors');
const { newReference } = require('../lib/reference');

const products = (activeOnly = true) =>
  db.query(`SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`).then(r => r[0]);

async function findProduct(id, activeOnly = true) {
  const [[row]] = await db.query(`SELECT * FROM products WHERE id = ? ${activeOnly ? 'AND active = 1' : ''}`, [id]);
  return row || null;
}

async function findDeposit(id) {
  const [[row]] = await db.query('SELECT * FROM deposit_requests WHERE id = ?', [id]);
  return row || null;
}

// Snapshot the product name and deposit inside a transaction, so an admin edit or delete
// between validation and insert cannot change what the visitor agreed to pay.
async function createDeposit(data) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[product]] = await conn.query('SELECT * FROM products WHERE id = ? AND active = 1 FOR UPDATE', [data.product_id]);
    if (!product) throw new HttpError(422, 'Please check the highlighted fields.', { product_id: 'That piece is not available.' });

    let reference, id;
    for (let attempt = 0; attempt < 6; attempt++) {
      reference = newReference('DEP-');
      try {
        const [r] = await conn.query(
          `INSERT INTO deposit_requests (reference, product_id, product_name, amount, currency, name, email, phone, notes, payment_method)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [reference, product.id, product.name, product.deposit, product.currency, data.name, data.email, data.phone, data.notes, data.payment_method]);
        id = r.insertId;
        break;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || attempt === 5) throw e;
      }
    }
    await conn.commit();
    return findDeposit(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function findForVisitor(reference, email) {
  const [[row]] = await db.query(
    'SELECT * FROM deposit_requests WHERE reference = ? AND email = ?',
    [String(reference).toUpperCase(), String(email || '').toLowerCase()]);
  return row || null;
}

async function list({ status, q, page, limit }) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(name LIKE ? OR email LIKE ? OR reference LIKE ? OR product_name LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM deposit_requests ${w}`, params);
  const [data] = await db.query(
    `SELECT * FROM deposit_requests ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]);
  return { data, total, page, limit };
}

async function setStatus(id, status) {
  const row = await findDeposit(id);
  if (!row) throw new HttpError(404, 'Deposit request not found.');
  await db.query('UPDATE deposit_requests SET status = ? WHERE id = ?', [status, id]);
  return findDeposit(id);
}

async function remove(id) {
  const row = await findDeposit(id);
  if (!row) throw new HttpError(404, 'Deposit request not found.');
  await db.query('DELETE FROM deposit_requests WHERE id = ?', [id]);
  return row;
}

async function stats() {
  const [rows] = await db.query('SELECT status, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM deposit_requests GROUP BY status');
  const out = { pending: 0, paid: 0, cancelled: 0, pending_amount: 0, paid_amount: 0 };
  rows.forEach(r => {
    out[r.status] = r.n;
    if (r.status === 'pending') out.pending_amount = Number(r.total);
    if (r.status === 'paid') out.paid_amount = Number(r.total);
  });
  return out;
}

module.exports = { products, findProduct, createDeposit, findForVisitor, list, setStatus, remove, stats };
