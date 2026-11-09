// One admin, password from .env. A successful login sets a signed token in an httpOnly cookie,
// so page scripts cannot read it, and SameSite=Strict stops other sites from using it.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../lib/errors');

const COOKIE = 'ink_admin';
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: admin sessions will end whenever the server restarts.');
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

function cookieOf(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const digest = s => crypto.createHash('sha256').update(String(s)).digest();

function login(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new HttpError(503, 'The admin area is disabled. Set ADMIN_PASSWORD in the .env file.');
  const given = req.body && req.body.password;
  if (typeof given !== 'string' || !crypto.timingSafeEqual(digest(given), digest(expected))) throw new HttpError(401, 'Wrong password.');
  const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.NODE_ENV === 'production', maxAge: EIGHT_HOURS });
  res.json({ ok: true });
}

function logout(req, res) {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(cookieOf(req, COOKIE) || '', SECRET);
    if (payload.role !== 'admin') throw new Error('role');
    next();
  } catch {
    throw new HttpError(401, 'Please sign in.');
  }
}

module.exports = { login, logout, requireAdmin };
