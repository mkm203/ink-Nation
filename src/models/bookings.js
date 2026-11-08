const crypto = require('crypto');
const db = require('../../config/db');
const { HttpError } = require('../lib/errors');

const ACTIVE = "('pending','confirmed')";
const slots = () => Math.max(1, Number(process.env.SLOTS_PER_ARTIST_PER_DAY) || 2);

// Reference codes avoid look-alike characters (0/O, 1/I/L) so they are easy to read out loud.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newReference() {
  const b = crypto.randomBytes(6);
  let s = 'INK-';
  for (let i = 0; i < 6; i++) s += CHARS[b[i] % CHARS.length];
  return s;
}

const SELECT = `SELECT b.*, a.name AS artist_name FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id`;

// Creates a booking inside a transaction so two people cannot take the last slot at once.
async function create(data) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (data.artist_id) {
      const [[artist]] = await conn.query('SELECT id FROM artists WHERE id = ? AND active = 1', [data.artist_id]);
      if (!artist) throw new HttpError(422, 'Please check the highlighted fields.', { artist_id: 'That artist is not available.' });
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM bookings WHERE artist_id = ? AND preferred_date = ? AND status IN ${ACTIVE} FOR UPDATE`,
        [data.artist_id, data.preferred_date]);
      if (n >= slots()) throw new HttpError(409, 'That artist is fully booked on this date. Please choose another day or another artist.', { date: 'Fully booked for this artist.' });
    }
    const [dup] = await conn.query(
      `SELECT id FROM bookings WHERE email = ? AND preferred_date = ? AND artist_id <=> ? AND status IN ${ACTIVE} LIMIT 1`,
      [data.email, data.preferred_date, data.artist_id]);
    if (dup.length) throw new HttpError(409, 'You already have a request for this artist on this date. Use your reference code to check its status.');

    let reference;
    for (let attempt = 0; attempt < 6; attempt++) {
      reference = newReference();
      try {
        await conn.query(
          `INSERT INTO bookings (reference, name, phone, email, artist_id, piece, colour_mode, preferred_date, idea, reference_image, tier_id, deposit_cents)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [reference, data.name, data.phone, data.email, data.artist_id, data.piece, data.colour_mode, data.preferred_date, data.idea, data.reference_image || null, data.tier_id || null, data.deposit_cents || 0]);
        break;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY' || attempt === 5) throw e;
      }
    }
    await conn.commit();
    const [[row]] = await conn.query(`${SELECT} WHERE b.reference = ?`, [reference]);
    return row;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// What a visitor may see about their own booking (needs the reference AND the email).
async function findForVisitor(reference, email) {
  const [[row]] = await db.query(`${SELECT} WHERE b.reference = ? AND b.email = ?`, [String(reference).toUpperCase(), String(email || '').toLowerCase()]);
  return row || null;
}

async function cancelForVisitor(reference, email) {
  const row = await findForVisitor(reference, email);
  if (!row) throw new HttpError(404, 'No booking matches that reference and email.');
  if (!['pending', 'confirmed'].includes(row.status)) throw new HttpError(409, `This booking is already ${row.status} and cannot be cancelled.`);
  await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [row.id]);
  return { ...row, status: 'cancelled' };
}

// Dates on which an artist has no slot left.
async function fullDates(artistId, from, to) {
  const [rows] = await db.query(
    `SELECT preferred_date AS d FROM bookings WHERE artist_id = ? AND preferred_date BETWEEN ? AND ? AND status IN ${ACTIVE}
     GROUP BY preferred_date HAVING COUNT(*) >= ?`, [artistId, from, to, slots()]);
  return rows.map(r => r.d);
}

async function list({ status, artistId, q, page, limit }) {
  const where = [];
  const params = [];
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (artistId) { where.push('b.artist_id = ?'); params.push(artistId); }
  if (q) { where.push('(b.name LIKE ? OR b.email LIKE ? OR b.reference LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM bookings b ${w}`, params);
  const [data] = await db.query(`${SELECT} ${w} ORDER BY b.preferred_date ASC, b.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  return { data, total, page, limit };
}

async function setStatus(id, status) {
  const [[row]] = await db.query('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Booking not found.');
  const reopening = ['pending', 'confirmed'].includes(status) && !['pending', 'confirmed'].includes(row.status);
  if (reopening && row.artist_id) {
    const [[{ n }]] = await db.query(
      `SELECT COUNT(*) AS n FROM bookings WHERE artist_id = ? AND preferred_date = ? AND status IN ${ACTIVE} AND id <> ?`, [row.artist_id, row.preferred_date, id]);
    if (n >= slots()) throw new HttpError(409, 'That artist is already fully booked on this date, so this booking cannot be reopened.');
  }
  await db.query('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);
  const [[out]] = await db.query(`${SELECT} WHERE b.id = ?`, [id]);
  return out;
}

async function remove(id) {
  const [[row]] = await db.query('SELECT reference_image FROM bookings WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Booking not found.');
  await db.query('DELETE FROM bookings WHERE id = ?', [id]);
  return row;
}

async function stats() {
  const [byStatus] = await db.query('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status');
  const [[{ upcoming }]] = await db.query("SELECT COUNT(*) AS upcoming FROM bookings WHERE preferred_date >= CURDATE() AND status IN ('pending','confirmed')");
  const [[{ questions }]] = await db.query('SELECT COUNT(*) AS questions FROM inquiries WHERE handled = 0');
  const counts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  byStatus.forEach(r => { counts[r.status] = r.n; });
  return { ...counts, upcoming, open_questions: questions };
}

module.exports = { create, findForVisitor, cancelForVisitor, fullDates, list, setStatus, remove, stats };
