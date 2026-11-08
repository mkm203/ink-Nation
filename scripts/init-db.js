// Creates the database, the tables and the starter content. Safe to run again:
// tables use IF NOT EXISTS, new columns are added only when missing, and content is only added to empty tables.
// Nothing you changed in the admin area is overwritten.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

const dbName = process.env.DB_NAME || 'inkster_db';
if (!/^[A-Za-z0-9_]+$/.test(dbName)) { console.error('DB_NAME may only contain letters, digits and _'); process.exit(1); }

const artists = [
  ['manuel', 'Manuel', 'Manuel works in the Japanese tradition. He plans large pieces as one composition, so the design flows with the body and the sessions build on each other.', 'Irezumi, large-scale pieces', 11, 'waves', 1],
  ['dalia', 'Dalia', 'Dalia draws with a light hand. Her florals and botanical work rely on patient shading and clean, thin lines, and she is happy to start small and grow a piece over time.', 'Black and grey, fine line', 5, 'rose', 2],
  ['laura', 'Laura', "Laura's style leans into subtlety but always carries emotional weight. She aims to make tattoos that are not just beautiful but deeply resonant. To her, every tattoo is more than an image. It is a quiet story, gently told.", 'Colour realism, custom pieces', 7, 'mandala', 3]
];
const works = [
  ['Irezumi', 'manuel', 'Japanese tattooing built on bold outlines, dense detail and deep symbolism. Pieces usually cover a whole back, arm or leg, and carry koi, dragons, waves and blossoms.', 'irezumi', 1],
  ['Black & grey', 'dalia', 'Soft shading and fine lines, built up in layers. Florals, portraits and botanical pieces that sit quietly on the skin and age well.', 'rose', 2],
  ['Colour ornament', 'laura', 'Mandalas and ornamental pieces in saturated colour, drawn to follow the shape of the shoulder, spine or sleeve they will live on.', 'mandala', 3]
];
const faqs = [
  ['Do I need a finished design?', 'No. Bring references, a rough sketch or just a description. Your artist will refine the idea with you before any ink is used, and you approve the final drawing.'],
  ['How should I prepare for my session?', 'Eat a proper meal, drink water, and sleep well the night before. Wear clothes that give easy access to the area being tattooed, and skip alcohol for 24 hours beforehand.'],
  ['Does it hurt?', 'It depends on the placement, the size and on you. Ribs, spine and feet tend to be more sensitive than outer arms and thighs. Tell your artist whenever you need a break.'],
  ['How do I look after a new tattoo?', 'Your artist will explain aftercare at the end of the session. In general: keep it clean, apply a thin layer of unscented moisturiser, avoid soaking and direct sun while it heals, and do not pick at it.'],
  ['How does booking work?', 'Send a request with the form below. We reply to talk through your idea and confirm a date. You can follow the status of your request with the reference code you receive. Choose "Not sure yet" if you want help picking the right artist.']
];
const tiers = [
  ['Small tattoo', 'Palm-sized or smaller: lettering, symbols, simple single-subject pieces.', 25000, 35000, 20000, 1],
  ['Medium tattoo', 'Roughly hand to forearm size, with more detail or shading.', 45000, null, 25000, 2],
  ['Large tattoo', 'Calf, thigh, shoulder blade or similar. Usually more than one session.', 120000, null, 50000, 3],
  ['Half sleeve', 'Shoulder to elbow or elbow to wrist, planned as one composition.', 200000, null, 100000, 4],
  ['Full sleeve', 'Shoulder to wrist, planned as one composition over several sessions.', 300000, null, 100000, 5]
];
const products = [
  ['Aftercare balm', 'Care', 'Fragrance-free healing balm made for fresh tattoos. 50 ml tin. (Example product: edit or replace it in the admin area.)', 1800, 40, 1],
  ['Studio tee', 'Apparel', 'Heavy black cotton t-shirt with the Ink Nation lettering. (Example product: edit or replace it in the admin area.)', 3500, 25, 2],
  ['Gift card', 'Gift', 'A gift card for a tattoo session, redeemed at the studio. (Example product: edit or replace it in the admin area.)', 10000, null, 3],
  ['Art print', 'Prints', 'A3 print of one of the studio flash sheets on heavy paper. (Example product: edit or replace it in the admin area.)', 4500, 15, 4]
];
const methods = [
  ['card', 'Card, Apple Pay, Google Pay', 0, '', 'Pay securely on the payment page. Apple Pay and Google Pay appear automatically on devices that support them.', 1],
  ['zelle', 'Zelle', 0, '', 'Open your bank app, choose Zelle, and send the exact amount to the account shown. Write the order code in the note.', 2],
  ['chime', 'Chime', 0, '', 'Open Chime, choose Move Money, and send the exact amount to the account shown. Write the order code in the note.', 3],
  ['bitcoin', 'Bitcoin', 0, '', 'Send the exact bitcoin amount to the address shown, or scan the QR code with your wallet.', 4]
];
const settings = {
  studio_name: 'Ink Nation Tattoo Studio',
  phone: '+237 600 000 000',
  email: 'hello@inknation.example',
  address: "Rue de l'Exemple 12, Douala",
  hours: 'Monday – Friday\n08:00 – 20:00',
  hero_image: '',
  pricing_note: 'Prices are estimates. Your artist confirms the final price after talking through your design. The deposit is taken off the final price.',
  discover_intro: 'Sizes and prices, deposits, and things from the studio you can order and pay for online.'
};

// Adds a column to an existing table only if it is not there yet (older databases from the first version).
async function ensureColumn(conn, table, column, ddl) {
  const [rows] = await conn.query('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column]);
  if (!rows.length) { await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${ddl}`); console.log(`Added column ${table}.${column}`); }
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));

  const count = async t => (await conn.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n;
  if (!(await count('artists'))) {
    for (const a of artists) await conn.query('INSERT INTO artists (slug,name,bio,specialty,experience_years,art_key,sort_order) VALUES (?,?,?,?,?,?,?)', a);
    console.log('Added 3 artists');
  }
  if (!(await count('works'))) {
    for (const w of works) {
      const [[a]] = await conn.query('SELECT id FROM artists WHERE slug=?', [w[1]]);
      await conn.query('INSERT INTO works (title,artist_id,description,art_key,sort_order) VALUES (?,?,?,?,?)', [w[0], a ? a.id : null, w[2], w[3], w[4]]);
    }
    console.log('Added 3 works');
  }
  if (!(await count('faqs'))) {
    let i = 1;
    for (const f of faqs) await conn.query('INSERT INTO faqs (question,answer,sort_order) VALUES (?,?,?)', [f[0], f[1], i++]);
    console.log('Added 5 FAQ entries');
  }
  for (const [k, v] of Object.entries(settings)) await conn.query('INSERT IGNORE INTO settings (k,v) VALUES (?,?)', [k, v]);

  // ---- update for databases created by the first version
  await ensureColumn(conn, 'bookings', 'tier_id', 'INT NULL AFTER reference_image');
  await ensureColumn(conn, 'bookings', 'deposit_cents', 'INT NOT NULL DEFAULT 0 AFTER tier_id');
  await ensureColumn(conn, 'bookings', 'deposit_paid', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER deposit_cents');
  await ensureColumn(conn, 'price_tiers', 'image', 'VARCHAR(255) NULL AFTER deposit_cents');
  if (!(await count('price_tiers'))) {
    for (const t of tiers) await conn.query('INSERT INTO price_tiers (name,description,price_cents,price_max_cents,deposit_cents,sort_order) VALUES (?,?,?,?,?,?)', t);
    console.log('Added your 5 pricing tiers');
  }
  if (!(await count('products'))) {
    for (const p of products) await conn.query('INSERT INTO products (name,category,description,price_cents,stock,sort_order) VALUES (?,?,?,?,?,?)', p);
    console.log('Added 4 example products (edit them in the admin area)');
  }
  for (const m of methods) await conn.query('INSERT IGNORE INTO payment_methods (method,label,enabled,account,instructions,sort_order) VALUES (?,?,?,?,?,?)', m);

  // One-time rename from the first version. Only touches values that still have the old default text.
  const [[done]] = await conn.query("SELECT COUNT(*) n FROM settings WHERE k = 'migrated_ink_nation'");
  if (!done.n) {
    await conn.query("UPDATE settings SET v = 'Ink Nation Tattoo Studio' WHERE k = 'studio_name' AND v = 'In-kster Tattoo Studio'");
    await conn.query("UPDATE settings SET v = 'hello@inknation.example' WHERE k = 'email' AND v = 'hello@in-kster.example'");
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM faqs');
    if (n) await conn.query('INSERT INTO faqs (question,answer,sort_order) VALUES (?,?,?)', ['How do deposits and online payments work?', 'Booking a size from our price list asks for a deposit, which is taken off the final price. You can pay it online right after you book, with a card, Apple Pay, Zelle, Chime or Bitcoin. Your request is confirmed once the studio has seen the payment.', 6]);
    await conn.query("INSERT INTO settings (k,v) VALUES ('migrated_ink_nation','1')");
    console.log('Renamed the studio to Ink Nation (only where the old default text was still in place)');
  }
  console.log(`Database "${dbName}" is ready.`);
  await conn.end();
})().catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
