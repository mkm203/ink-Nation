const db = require('../../config/db');

const tiers = (activeOnly = true) =>
  db.query(`SELECT id, name, description, price_cents, price_max_cents, deposit_cents, image, sort_order, active FROM price_tiers ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, id`).then(r => r[0]);
const tier = async id => (await db.query('SELECT * FROM price_tiers WHERE id = ? AND active = 1', [id]))[0][0] || null;
const products = () =>
  db.query('SELECT id, name, category, description, price_cents, stock, image FROM products WHERE active = 1 ORDER BY sort_order, id').then(r => r[0]);

const methods = () => db.query('SELECT method, label, enabled, account, instructions FROM payment_methods ORDER BY sort_order').then(r => r[0]);
const method = async key => (await db.query('SELECT method, label, enabled, account, instructions FROM payment_methods WHERE method = ?', [key]))[0][0] || null;

module.exports = { tiers, tier, products, methods, method };
