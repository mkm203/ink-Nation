// End-to-end API test. It uses a SEPARATE SQLite file, so your real data is never touched.
// Run with: npm test
process.env.NODE_ENV = 'test';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
process.env.DB_FILE = path.join(__dirname, '..', 'data', 'inkster-test.db');
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'studio@example.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-pass';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
process.env.SLOTS_PER_ARTIST_PER_DAY = '2';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

// Photos are saved on disk during the tests (a section near the end tests saving them in the database).
process.env.UPLOAD_STORAGE = process.env.UPLOAD_STORAGE || 'disk';

// Start from an empty test database every run.
for (const f of [process.env.DB_FILE, process.env.DB_FILE + '-wal', process.env.DB_FILE + '-shm']) fs.rmSync(f, { force: true });
// To test the Turso connection, run a local libSQL server (sqld) and set TURSO_DATABASE_URL=http://127.0.0.1:8080.
// The tests empty that database first, so they refuse to run against anything that is not on this computer.
if ((process.env.TURSO_DATABASE_URL || '').trim()) {
  if (!/^(https?|libsql):\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(process.env.TURSO_DATABASE_URL.trim())) { console.error('The tests only run against a libSQL server on this computer, never a real Turso database.'); process.exit(1); }
  execFileSync('node', ['-e', "const db=require('./config/db');(async()=>{for(const t of ['order_items','orders','payment_methods','products','price_tiers','inquiries','bookings','settings','reviews','faqs','artist_photos','works','artists','ink_files'])await db.exec('DROP TABLE IF EXISTS '+t);await db.end()})()"], { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'inherit' });
  console.log('(running against the libSQL server at ' + process.env.TURSO_DATABASE_URL + ')');
}
execFileSync('node', [path.join(__dirname, 'init-db.js')], { env: process.env, stdio: 'ignore' });
const db = require('../config/db');
const orders = require('../src/models/orders');
const pay = require('../src/lib/payments');
const app = require('../server');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const uploads = require('../src/lib/images').UPLOAD_DIR;
const keep = new Set(fs.readdirSync(uploads)); // files that were there before the test: never touched
const pad = n => String(n).padStart(2, '0');
function nextWeekday(minDays, skip = 0) {
  const d = new Date(); d.setDate(d.getDate() + minDays);
  let seen = -1;
  for (;;) { if (d.getDay() % 6 !== 0) { seen++; if (seen === skip) break; } d.setDate(d.getDate() + 1); }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nextWeekend() { const d = new Date(); d.setDate(d.getDate() + 10); while (d.getDay() % 6 !== 0) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

let base, cookie = '', passed = 0, failed = 0;
async function call(method, url, body, opts = {}) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  if (opts.auth !== false && cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method, headers, body: payload });
  const sc = r.headers.get('set-cookie');
  if (sc && /ink_admin=[^;]+/.test(sc) && !/ink_admin=;/.test(sc)) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
function form(obj, file) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f.append(k, String(v));
  if (file) f.append(file.field, new Blob([file.buffer], { type: file.type || 'image/png' }), file.name || 'x.png');
  return f;
}
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.message || e).split('\n').join('\n       ')); }
}

(async () => {
  await db.query('DELETE FROM bookings'); await db.query('DELETE FROM inquiries'); await db.query('DELETE FROM orders'); await db.query('DELETE FROM reviews'); await db.query('DELETE FROM artist_photos');
  // A fake Stripe and a fake bitcoin price service, so payments can be tested without real accounts or money.
  const fake = { sessions: new Map(), n: 0, stripeDown: false, rate: '50000.00', rateDown: false, lastForm: null };
  const fakeServer = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/brevo') { fake.brevo = { key: req.headers['api-key'], body: JSON.parse(raw || '{}') }; return fake.brevoDown ? send(401, { message: 'Key not found' }) : send(201, { messageId: '<x@y>' }); }
      if (req.url === '/rate') return fake.rateDown ? send(500, {}) : send(200, { data: { amount: fake.rate } });
      if (!/Bearer sk_test_/.test(req.headers.authorization || '')) return send(401, { error: { message: 'no key' } });
      if (fake.stripeDown) return send(500, { error: { message: 'down' } });
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const f = new URLSearchParams(raw); fake.lastForm = f; let amount = 0;
        for (let i = 0; f.has(`line_items[${i}][quantity]`); i++) amount += Number(f.get(`line_items[${i}][quantity]`)) * Number(f.get(`line_items[${i}][price_data][unit_amount]`));
        const id = 'cs_test_' + (++fake.n);
        const s = { id, url: 'https://checkout.stripe.test/pay/' + id, amount_total: amount, currency: 'usd', client_reference_id: f.get('client_reference_id'), payment_status: 'unpaid', status: 'open' };
        fake.sessions.set(id, s); return send(200, s);
      }
      const m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(req.url);
      if (req.method === 'GET' && m && fake.sessions.has(m[1])) return send(200, fake.sessions.get(m[1]));
      send(404, { error: { message: 'nope' } });
    });
  });
  await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
  process.env.STRIPE_API_BASE = 'http://127.0.0.1:' + fakeServer.address().port;
  process.env.BTC_RATE_URL = process.env.STRIPE_API_BASE + '/rate';
  const server = app.listen(0); base = 'http://127.0.0.1:' + server.address().port;
  const [[laura]] = await db.query("SELECT id FROM artists WHERE slug = 'laura'");
  const [[manuel]] = await db.query("SELECT id FROM artists WHERE slug = 'manuel'");
  const d1 = nextWeekday(14), d2 = nextWeekday(14, 1);
  const person = (n, extra = {}) => ({ name: 'Test ' + n, phone: '+237 600 000 00' + n, email: `t${n}@example.com`, piece: 'Half sleeve', date: d1, artist_id: laura.id, ...extra });

  console.log('\nPublic content');
  await t('health reports the database', async () => { const r = await call('GET', '/api/health'); assert.equal(r.status, 200); assert.equal(r.json.database, 'connected'); });
  await t('studio, artists, works and FAQ come from the database', async () => {
    assert.ok((await call('GET', '/api/studio')).json.phone);
    assert.equal((await call('GET', '/api/artists')).json.length, 3);
    assert.equal((await call('GET', '/api/works')).json.length, 3);
    assert.ok((await call('GET', '/api/faq')).json.length >= 5);
    assert.ok(Array.isArray((await call('GET', '/api/reviews')).json));
  });
  await t('unknown API route gives JSON 404', async () => { const r = await call('GET', '/api/nope'); assert.equal(r.status, 404); assert.ok(r.json.error); });
  await t('malformed JSON gives 400', async () => { const r = await call('POST', '/api/inquiries', '{"a":'); assert.equal(r.status, 400); });

  console.log('\nBooking rules');
  await t('empty request lists every missing field (422)', async () => {
    const r = await call('POST', '/api/bookings', {}); assert.equal(r.status, 422);
    for (const f of ['name', 'phone', 'email', 'date']) assert.ok(r.json.fields[f], 'missing message for ' + f);
  });
  await t('weekend date is refused (422)', async () => { const r = await call('POST', '/api/bookings', person(1, { date: nextWeekend() })); assert.equal(r.status, 422); assert.ok(r.json.fields.date); });
  await t('past date is refused (422)', async () => { const r = await call('POST', '/api/bookings', person(1, { date: '2020-01-06' })); assert.equal(r.status, 422); });
  await t('impossible date 2027-02-30 is refused (422)', async () => { const r = await call('POST', '/api/bookings', person(1, { date: '2027-02-30' })); assert.equal(r.status, 422); });
  await t('bad phone and bad email are refused (422)', async () => {
    const r = await call('POST', '/api/bookings', person(1, { phone: 'abc', email: 'nope' }));
    assert.equal(r.status, 422); assert.ok(r.json.fields.phone && r.json.fields.email);
  });
  await t('unknown or hidden size (tier) is refused (422)', async () => { const r = await call('POST', '/api/bookings', person(1, { tier_id: 99999 })); assert.equal(r.status, 422); assert.ok(r.json.fields.tier_id); });
  await t('unknown artist is refused (422)', async () => { const r = await call('POST', '/api/bookings', person(1, { artist_id: 9999 })); assert.equal(r.status, 422); });
  let ref1;
  await t('valid request is stored and returns a reference (201), without private data', async () => {
    const r = await call('POST', '/api/bookings', person(1, { bw: true })); assert.equal(r.status, 201);
    assert.match(r.json.reference, /^INK-[A-Z2-9]{6}$/); assert.equal(r.json.status, 'pending'); assert.equal(r.json.colour_mode, 'bw');
    assert.equal(r.json.email, undefined); assert.equal(r.json.phone, undefined); ref1 = r.json.reference;
  });
  await t('same person, same artist, same day is refused (409)', async () => { const r = await call('POST', '/api/bookings', person(1)); assert.equal(r.status, 409); });
  await t('artist capacity: 2 slots per day, third is refused (409)', async () => {
    assert.equal((await call('POST', '/api/bookings', person(2))).status, 201);
    const r = await call('POST', '/api/bookings', person(3)); assert.equal(r.status, 409); assert.match(r.json.error, /fully booked/);
  });
  await t('another artist is still free that day', async () => assert.equal((await call('POST', '/api/bookings', person(3, { artist_id: manuel.id }))).status, 201));
  await t('availability lists the full date for Laura only', async () => {
    assert.ok((await call('GET', `/api/availability?artistId=${laura.id}`)).json.full.includes(d1));
    assert.ok(!(await call('GET', `/api/availability?artistId=${manuel.id}`)).json.full.includes(d1));
    assert.equal((await call('GET', '/api/availability')).status, 400);
  });
  await t('status lookup needs reference AND matching email', async () => {
    assert.equal((await call('GET', `/api/bookings/${ref1}?email=t1@example.com`)).json.status, 'pending');
    assert.equal((await call('GET', `/api/bookings/${ref1}?email=other@example.com`)).status, 404);
    assert.equal((await call('GET', `/api/bookings/${ref1}`)).status, 404);
  });
  await t('visitor cancel frees the slot, and cannot cancel twice', async () => {
    assert.equal((await call('POST', `/api/bookings/${ref1}/cancel`, { email: 'T1@example.com' })).json.status, 'cancelled');
    assert.equal((await call('POST', `/api/bookings/${ref1}/cancel`, { email: 't1@example.com' })).status, 409);
    assert.equal((await call('POST', '/api/bookings', person(3))).status, 201);
  });
  await t('reference photo: real PNG saved (201), fake image refused (400), over 5 MB refused (413)', async () => {
    const before = fs.readdirSync(uploads).length;
    const ok = await call('POST', '/api/bookings', form(person(4, { date: d2 }), { field: 'reference_image', buffer: PNG }));
    assert.equal(ok.status, 201); assert.equal(fs.readdirSync(uploads).length, before + 1);
    const bad = await call('POST', '/api/bookings', form(person(5, { date: d2 }), { field: 'reference_image', buffer: Buffer.from('<script>alert(1)</script>............'), name: 'a.png' }));
    assert.equal(bad.status, 400); assert.equal(fs.readdirSync(uploads).length, before + 1);
    const big = await call('POST', '/api/bookings', form(person(6, { date: d2 }), { field: 'reference_image', buffer: Buffer.concat([PNG, Buffer.alloc(5.5 * 1024 * 1024)]) }));
    assert.equal(big.status, 413);
    const [[row]] = await db.query('SELECT reference_image FROM bookings WHERE email = ?', ['t4@example.com']);
    assert.ok(row.reference_image.startsWith('/uploads/')); assert.equal((await fetch(base + row.reference_image)).status, 200);
  });
  await t('question form: valid (201), invalid (422)', async () => {
    assert.equal((await call('POST', '/api/inquiries', { name: 'Ana', email: 'ana@example.com', question: 'Do you do cover-ups?' })).status, 201);
    assert.equal((await call('POST', '/api/inquiries', { name: 'A', email: 'x', question: '?' })).status, 422);
  });

  console.log('\nAdmin area');
  await t('every admin route needs sign-in (401)', async () => {
    for (const [m, u] of [['GET', '/api/admin/bookings'], ['PATCH', '/api/admin/bookings/1'], ['DELETE', '/api/admin/bookings/1'], ['GET', '/api/admin/stats'], ['POST', '/api/admin/artists'], ['PUT', '/api/admin/studio'], ['GET', '/api/admin/inquiries'], ['POST', '/api/admin/reviews']]) {
      const r = await call(m, u, m === 'GET' ? undefined : {}, { auth: false }); assert.equal(r.status, 401, `${m} ${u} gave ${r.status}`);
    }
  });
  await t('wrong password is refused (401), right password signs in', async () => {
    assert.equal((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
    assert.equal((await call('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status, 200); assert.ok(cookie);
  });
  await t('a forged cookie is refused', async () => { const r = await fetch(base + '/api/admin/stats', { headers: { Cookie: 'ink_admin=abc.def.ghi' } }); assert.equal(r.status, 401); });
  await t('stats, list, filter and search bookings', async () => {
    const s = (await call('GET', '/api/admin/stats')).json; assert.ok(s.pending >= 3 && s.cancelled >= 1);
    const all = (await call('GET', '/api/admin/bookings')).json; assert.ok(all.total >= 5 && all.data[0].artist_name !== undefined);
    assert.ok((await call('GET', '/api/admin/bookings?status=cancelled')).json.data.every(b => b.status === 'cancelled'));
    assert.equal((await call('GET', '/api/admin/bookings?q=t4@example')).json.total, 1);
    assert.equal((await call('GET', '/api/admin/bookings?status=bogus')).status, 400);
  });
  await t('confirm a booking; reopening into a full day is refused (409)', async () => {
    const [[b]] = await db.query('SELECT id FROM bookings WHERE email = ?', ['t2@example.com']);
    assert.equal((await call('PATCH', `/api/admin/bookings/${b.id}`, { status: 'confirmed' })).json.status, 'confirmed');
    assert.equal((await call('PATCH', `/api/admin/bookings/${b.id}`, { status: 'sideways' })).status, 422);
    const [[c]] = await db.query("SELECT id FROM bookings WHERE reference = ?", [ref1]);
    const r = await call('PATCH', `/api/admin/bookings/${c.id}`, { status: 'pending' }); assert.equal(r.status, 409);
    assert.equal((await call('PATCH', '/api/admin/bookings/999999', { status: 'pending' })).status, 404);
  });
  await t('delete a booking also removes its photo file', async () => {
    const [[b]] = await db.query('SELECT id, reference_image FROM bookings WHERE email = ?', ['t4@example.com']);
    const file = path.join(uploads, path.basename(b.reference_image)); assert.ok(fs.existsSync(file));
    assert.equal((await call('DELETE', `/api/admin/bookings/${b.id}`)).status, 204);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file));
  });
  await t('questions: list and mark handled', async () => {
    const q = (await call('GET', '/api/admin/inquiries')).json; assert.ok(q.length >= 1);
    assert.equal((await call('PATCH', `/api/admin/inquiries/${q[0].id}`, { handled: true })).status, 200);
  });
  await t('artist: create with photo, duplicate slug (409), edit, replace photo, delete', async () => {
    const mk = extra => form({ slug: 'sana', name: 'Sana', bio: 'Fine line artist.', specialty: 'Fine line', experience_years: 3, art_key: 'rose', sort_order: 9, active: 1, ...extra }, { field: 'image', buffer: PNG });
    const c = await call('POST', '/api/admin/artists', mk()); assert.equal(c.status, 201); const id = c.json.id; const photo1 = c.json.photo; assert.ok(photo1);
    assert.equal((await call('POST', '/api/admin/artists', mk())).status, 409);
    assert.equal((await call('POST', '/api/admin/artists', form({ slug: 'Bad Slug', name: 'x' }))).status, 422);
    const u = await call('PUT', `/api/admin/artists/${id}`, form({ slug: 'sana', name: 'Sana K', bio: 'Updated.', specialty: 'Fine line', experience_years: 4, art_key: 'rose', sort_order: 9, active: 1 }, { field: 'image', buffer: PNG }));
    assert.equal(u.status, 200); assert.equal(u.json.name, 'Sana K'); assert.notEqual(u.json.photo, photo1);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(path.join(uploads, path.basename(photo1))), 'old photo should be deleted');
    assert.ok((await call('GET', '/api/artists')).json.some(a => a.slug === 'sana'));
    assert.equal((await call('PUT', `/api/admin/artists/${id}`, form({ slug: 'sana', name: 'Sana K', bio: 'x', specialty: 'y', active: 0 }))).status, 200);
    assert.ok(!(await call('GET', '/api/artists')).json.some(a => a.slug === 'sana'), 'inactive artist is hidden from the site');
    assert.equal((await call('DELETE', `/api/admin/artists/${id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/admin/artists/${id}`)).status, 404);
  });
  await t('recent work: studio pieces only; create, edit, delete; FAQ: create, edit, delete', async () => {
    const w = await call('POST', '/api/admin/works', form({ title: 'Test piece', description: 'Desc', art_key: 'mandala', sort_order: 8 })); assert.equal(w.status, 201);
    assert.equal(w.json.artist_id, null);
    assert.ok((await call('GET', '/api/works', undefined, { auth: false })).json.some(x => x.id === w.json.id));
    assert.equal((await call('DELETE', `/api/admin/works/${w.json.id}`)).status, 204);
    const f = await call('POST', '/api/admin/faqs', { question: 'Q?', answer: 'A.', sort_order: 9 }); assert.equal(f.status, 201);
    assert.equal((await call('PUT', `/api/admin/faqs/${f.json.id}`, { question: 'Q2?', answer: 'A2.', sort_order: 9 })).json.question, 'Q2?');
    assert.equal((await call('DELETE', `/api/admin/faqs/${f.json.id}`)).status, 204);
  });
  await t('artist gallery: needs a picture, appears with the artist, never in recent work, files cleaned up', async () => {
    const a = await call('POST', '/api/admin/artists', form({ slug: 'gallery-test', name: 'Gallery Test', bio: 'x', specialty: 'y', experience_years: 1, art_key: 'rose', sort_order: 10, active: 1 }));
    assert.equal(a.status, 201);
    const g1 = await call('POST', '/api/admin/artist_photos', form({ artist_id: a.json.id, title: 'Piece one', sort_order: 1 }, { field: 'image', buffer: PNG }));
    assert.equal(g1.status, 201); assert.match(g1.json.image, /^\/uploads\/[a-f0-9]+\.png$/);
    const g2 = await call('POST', '/api/admin/artist_photos', form({ artist_id: a.json.id, title: 'Piece two', sort_order: 2 }, { field: 'image', buffer: PNG }));
    assert.equal(g2.status, 201);
    assert.equal((await call('POST', '/api/admin/artist_photos', form({ artist_id: a.json.id, title: 'No picture' }))).status, 400);
    assert.equal((await call('POST', '/api/admin/artist_photos', form({ artist_id: 9999, title: 'Bad' }, { field: 'image', buffer: PNG }))).status, 422);
    const artist = (await call('GET', '/api/artists', undefined, { auth: false })).json.find(x => x.id === a.json.id);
    assert.equal(artist.photos.length, 2); assert.equal(artist.photos[0].title, 'Piece one');
    assert.ok(!(await call('GET', '/api/works', undefined, { auth: false })).json.some(w => w.artist_id === a.json.id), 'artist work never appears in recent work');
    const file1 = path.join(uploads, path.basename(g1.json.image));
    assert.equal((await call('DELETE', `/api/admin/artist_photos/${g1.json.id}`)).status, 204);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file1), 'deleting a gallery photo removes its file');
    const file2 = path.join(uploads, path.basename(g2.json.image));
    assert.equal((await call('DELETE', `/api/admin/artists/${a.json.id}`)).status, 204);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file2), 'deleting an artist removes the rest of the gallery files');
  });
  await t('reviews: add with a reviewer photo, edit, hide and delete; the public sees only active reviews', async () => {
    assert.equal((await call('POST', '/api/admin/reviews', { name: '', review: 'x', rating: '5' })).status, 422);
    assert.equal((await call('POST', '/api/admin/reviews', { name: 'Jo', review: 'Lovely work.', rating: '9' })).status, 422);
    const c = await call('POST', '/api/admin/reviews', form({ name: 'Jo', rating: '5', review: 'Lovely work.', sort_order: 1, active: 1 }, { field: 'image', buffer: PNG }));
    assert.equal(c.status, 201); assert.equal(c.json.rating, 5); assert.ok(c.json.image);
    const imgFile = path.join(uploads, path.basename(c.json.image)); assert.ok(fs.existsSync(imgFile));
    const pub = (await call('GET', '/api/reviews', undefined, { auth: false })).json.find(r => r.id === c.json.id);
    assert.equal(pub.image, c.json.image, 'the reviewer photo is public');
    const u = await call('PUT', `/api/admin/reviews/${c.json.id}`, { name: 'Jo B', rating: '4', review: 'Updated.', sort_order: 1, active: 0 });
    assert.equal(u.status, 200); assert.equal(u.json.rating, 4); assert.equal(u.json.image, c.json.image, 'editing text keeps the photo');
    assert.ok(!(await call('GET', '/api/reviews', undefined, { auth: false })).json.some(r => r.id === c.json.id), 'hidden review is not public');
    assert.equal((await call('DELETE', `/api/admin/reviews/${c.json.id}`)).status, 204);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(imgFile), 'deleting a review removes its photo');
  });
  await t('studio details and hero photo show on the public API', async () => {
    assert.equal((await call('PUT', '/api/admin/studio', { studio_name: 'Ink Nation', phone: '+237 611 111 111', email: 'a@b.cd', address: 'Somewhere 1', hours: 'Mon-Fri', pricing_note: 'Prices are estimates.', discover_intro: 'Hello.' })).status, 200);
    assert.equal((await call('GET', '/api/studio', undefined, { auth: false })).json.pricing_note, 'Prices are estimates.');
    assert.equal((await call('GET', '/api/studio', undefined, { auth: false })).json.phone, '+237 611 111 111');
    assert.equal((await call('PUT', '/api/admin/studio', { studio_name: 'x' })).status, 422);
    const h = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: PNG })); assert.equal(h.status, 200);
    assert.equal((await call('GET', '/api/studio')).json.hero_image, h.json.hero_image);
    assert.equal((await call('DELETE', '/api/admin/studio/hero')).status, 204);
    assert.equal((await call('GET', '/api/studio')).json.hero_image, '');
  });
  console.log('\nPricing tiers');
  await t('your five prices and deposits are in place and public', async () => {
    const r = (await call('GET', '/api/tiers', undefined, { auth: false })).json;
    const by = n => r.find(x => x.name === n);
    assert.equal(r.length, 5);
    assert.deepEqual([by('Small tattoo').price_cents, by('Small tattoo').price_max_cents, by('Small tattoo').deposit_cents], [25000, 35000, 20000]);
    assert.deepEqual([by('Medium tattoo').price_cents, by('Medium tattoo').deposit_cents], [45000, 25000]);
    assert.deepEqual([by('Large tattoo').price_cents, by('Large tattoo').deposit_cents], [120000, 50000]);
    assert.deepEqual([by('Half sleeve').price_cents, by('Half sleeve').deposit_cents], [200000, 100000]);
    assert.deepEqual([by('Full sleeve').price_cents, by('Full sleeve').deposit_cents], [300000, 100000]);
  });
  let tierId;
  await t('admin: add a size typing dollars ("$1,250.50"), bad values refused, edit, hide, delete', async () => {
    assert.equal((await call('POST', '/api/admin/tiers', { name: 'Bad', price_cents: 'abc', deposit_cents: '10' })).status, 422);
    const bad = await call('POST', '/api/admin/tiers', { name: 'Bad', price_cents: '100', deposit_cents: '150' }); assert.equal(bad.status, 422); assert.ok(bad.json.fields.deposit_cents);
    const bad2 = await call('POST', '/api/admin/tiers', { name: 'Bad', price_cents: '300', price_max_cents: '200', deposit_cents: '50' }); assert.equal(bad2.status, 422); assert.ok(bad2.json.fields.price_max_cents);
    const c = await call('POST', '/api/admin/tiers', { name: 'Test size', description: 'x', price_cents: '$1,250.50', deposit_cents: '300', sort_order: 99, active: 1 });
    assert.equal(c.status, 201); assert.equal(c.json.price_cents, 125050); assert.equal(c.json.deposit_cents, 30000); tierId = c.json.id;
    const u = await call('PUT', `/api/admin/tiers/${tierId}`, { name: 'Test size', price_cents: '999', price_max_cents: '1200', deposit_cents: '300', sort_order: 99, active: 1 });
    assert.equal(u.status, 200); assert.equal(u.json.price_cents, 99900); assert.equal(u.json.price_max_cents, 120000);
    assert.ok((await call('GET', '/api/tiers')).json.some(x => x.id === tierId));
    await call('PUT', `/api/admin/tiers/${tierId}`, { name: 'Test size', price_cents: '999', deposit_cents: '300', active: 0 });
    assert.ok(!(await call('GET', '/api/tiers')).json.some(x => x.id === tierId), 'hidden size is not public');
    assert.equal((await call('POST', '/api/bookings', person(1, { tier_id: tierId }))).status, 422);
    assert.equal((await call('DELETE', `/api/admin/tiers/${tierId}`)).status, 204);
  });
  await t('admin: add a photo to a tattoo size, replace it, remove it and delete the size', async () => {
    const base = { name: 'Photo size', price_cents: '250', deposit_cents: '50', sort_order: 98, active: 1 };
    const c = await call('POST', '/api/admin/tiers', form(base, { field: 'image', buffer: PNG }));
    assert.equal(c.status, 201); assert.match(c.json.image, /^\/uploads\/[a-f0-9]+\.png$/);
    const id = c.json.id, first = c.json.image;
    assert.equal((await call('GET', '/api/tiers')).json.find(x => x.id === id).image, first);
    const file1 = path.join(uploads, path.basename(first)); assert.ok(fs.existsSync(file1));
    const u = await call('PUT', `/api/admin/tiers/${id}`, form(base, { field: 'image', buffer: PNG }));
    assert.equal(u.status, 200); assert.notEqual(u.json.image, first);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file1), 'old price photo is deleted');
    const file2 = path.join(uploads, path.basename(u.json.image));
    const r = await call('PUT', `/api/admin/tiers/${id}`, form({ ...base, remove_image: '1' }));
    assert.equal(r.status, 200); assert.equal(r.json.image, null);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file2), 'removed price photo is deleted');
    assert.equal((await call('DELETE', `/api/admin/tiers/${id}`)).status, 204);
  });
  const dDay = nextWeekday(20);
  let depRef, depEmail = 'dep1@example.com';
  await t('booking with a size stores the size, its name and the deposit', async () => {
    const [[med]] = await db.query("SELECT id FROM price_tiers WHERE name = 'Medium tattoo'");
    const r = await call('POST', '/api/bookings', { name: 'Dep One', phone: '+1 555 123 4567', email: depEmail, tier_id: med.id, date: dDay, artist_id: manuel.id });
    assert.equal(r.status, 201); assert.equal(r.json.piece, 'Medium tattoo'); assert.equal(r.json.deposit_cents, 25000); assert.equal(r.json.deposit_paid, false); depRef = r.json.reference;
    const none = await call('POST', '/api/bookings', { name: 'No Tier', phone: '+1 555 123 4568', email: 'dep2@example.com', date: dDay, artist_id: manuel.id });
    assert.equal(none.status, 201); assert.equal(none.json.piece, 'Not sure yet'); assert.equal(none.json.deposit_cents, 0);
  });

  console.log('\nShop products and ways to pay');
  const prod = {};
  await t('admin: create products (money, stock, photo), validation', async () => {
    assert.equal((await call('POST', '/api/admin/products', form({ name: 'Bad', price_cents: '0.10' }))).status, 422);
    const mk = async (name, price, stock) => (await call('POST', '/api/admin/products', form({ name, category: 'Test', description: 'd', price_cents: price, stock, sort_order: 50, active: 1 }, name === 'T Balm' ? { field: 'image', buffer: PNG } : undefined)));
    const a = await mk('T Balm', '18', 10); assert.equal(a.status, 201); assert.equal(a.json.price_cents, 1800); assert.ok(a.json.image); prod.balm = a.json.id;
    const b = await mk('T Tee', '35.50', 1); assert.equal(b.json.price_cents, 3550); prod.tee = b.json.id;
    const c = await mk('T Gift', '100', undefined); assert.equal(c.json.stock, null); prod.gift = c.json.id;
    const d = await mk('T Race', '10', 3); prod.race = d.json.id;
    const e = await mk('T Hidden', '10', 5); prod.hidden = e.json.id;
    await call('PUT', `/api/admin/products/${prod.hidden}`, form({ name: 'T Hidden', price_cents: '10', stock: 5, active: 0 }));
    const pub = (await call('GET', '/api/products', undefined, { auth: false })).json;
    assert.ok(pub.some(p => p.id === prod.balm) && !pub.some(p => p.id === prod.hidden), 'hidden product is not public');
  });
  await t('no way to pay is on yet: public list is empty and ordering is refused (422)', async () => {
    assert.deepEqual((await call('GET', '/api/payment-methods', undefined, { auth: false })).json, []);
    const r = await call('POST', '/api/orders', { name: 'Zed Buyer', email: 'z@example.com', method: 'zelle', items: [{ product_id: prod.balm, qty: 1 }] });
    assert.equal(r.status, 422);
  });
  await t('admin: switching a method on needs its account; bitcoin address is checked', async () => {
    const put = (m, b) => call('PUT', `/api/admin/payments/${m}`, { label: m, instructions: 'Do it.', ...b });
    assert.equal((await put('zelle', { enabled: 1, account: '' })).status, 422);
    assert.equal((await put('bitcoin', { enabled: 1, account: 'not-an-address' })).status, 422);
    assert.equal((await put('zelle', { enabled: 1, account: 'pay@inknation.example' })).status, 200);
    assert.equal((await put('chime', { enabled: 1, account: '$inknation' })).status, 200);
    assert.equal((await put('bitcoin', { enabled: 1, account: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' })).status, 200);
    assert.equal((await put('card', { enabled: 1 })).status, 200);
    assert.equal((await call('PUT', '/api/admin/payments/paypal', { label: 'x' })).status, 404);
    const pub = (await call('GET', '/api/payment-methods', undefined, { auth: false })).json;
    assert.deepEqual(pub.map(m => m.method), ['card', 'zelle', 'chime', 'bitcoin']);
    assert.ok(!JSON.stringify(pub).includes('pay@inknation') && !JSON.stringify(pub).includes('bc1q'), 'accounts are only shown after an order is placed');
  });

  console.log('\nOrders');
  const buyer = { name: 'Zed Buyer', email: 'zed@example.com', phone: '+1 555 000 1111' };
  const stockOf = async id => (await db.query('SELECT stock FROM products WHERE id = ?', [id]))[0][0].stock;
  let zOrder;
  await t('Zelle order: server sets the price, reserves stock, shows where to pay', async () => {
    const r = await call('POST', '/api/orders', { ...buyer, method: 'zelle', items: [{ product_id: prod.balm, qty: 2, unit_cents: 1, price_cents: 1 }, { product_id: prod.tee, qty: 1 }] });
    assert.equal(r.status, 201); const o = r.json; zOrder = o;
    assert.match(o.reference, /^ORD-[A-Z2-9]{6}$/); assert.equal(o.total_cents, 1800 * 2 + 3550); assert.equal(o.status, 'awaiting_payment');
    assert.equal(o.payment.type, 'manual'); assert.equal(o.payment.account, 'pay@inknation.example'); assert.equal(o.payment.memo, o.reference); assert.equal(o.payment.amount_cents, 7150);
    assert.equal(await stockOf(prod.balm), 8); assert.equal(await stockOf(prod.tee), 0);
  });
  await t('over-stock, sold-out, hidden, bad quantity, empty cart, bad method are refused; stock untouched', async () => {
    const go = items => call('POST', '/api/orders', { ...buyer, method: 'zelle', items });
    assert.equal((await go([{ product_id: prod.balm, qty: 9 }])).status, 409);
    assert.equal((await go([{ product_id: prod.tee, qty: 1 }])).status, 409);
    assert.equal((await go([{ product_id: prod.hidden, qty: 1 }])).status, 409);
    assert.equal((await go([{ product_id: prod.balm, qty: 0 }])).status, 422);
    assert.equal((await go([{ product_id: prod.balm, qty: 21 }])).status, 422);
    assert.equal((await go([{ product_id: prod.balm, qty: 1.5 }])).status, 422);
    assert.equal((await go([])).status, 422);
    assert.equal((await go([{ product_id: 999999, qty: 1 }])).status, 409);
    assert.equal((await call('POST', '/api/orders', { ...buyer, method: 'paypal', items: [{ product_id: prod.balm, qty: 1 }] })).status, 422);
    assert.equal((await call('POST', '/api/orders', { name: 'A', email: 'bad', method: 'zelle', items: [{ product_id: prod.balm, qty: 1 }] })).status, 422);
    assert.equal(await stockOf(prod.balm), 8);
  });
  await t('race: 6 buyers fight for the last 3 items, exactly 3 win and stock ends at 0', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(i => call('POST', '/api/orders', { name: 'Racer ' + i, email: `r${i}@example.com`, method: 'chime', items: [{ product_id: prod.race, qty: 1 }] })));
    assert.equal(rs.filter(r => r.status === 201).length, 3); assert.equal(rs.filter(r => r.status === 409).length, 3);
    assert.equal(await stockOf(prod.race), 0);
  });
  await t('order lookup needs the code AND the email', async () => {
    const ok = await call('GET', `/api/orders/${zOrder.reference}?email=ZED@example.com`); assert.equal(ok.status, 200); assert.equal(ok.json.total_cents, 7150); assert.equal(ok.json.email, undefined);
    assert.equal((await call('GET', `/api/orders/${zOrder.reference}?email=other@example.com`)).status, 404);
    assert.equal((await call('GET', `/api/orders/${zOrder.reference}`)).status, 404);
  });
  await t('customer says "I sent it" (repeatable); the studio sees it first in the admin list', async () => {
    const r = await call('POST', `/api/orders/${zOrder.reference}/submitted`, { email: buyer.email, payment_note: 'conf 12345' });
    assert.equal(r.status, 200); assert.equal(r.json.status, 'payment_submitted'); assert.equal(r.json.payment.submitted, true);
    assert.equal((await call('POST', `/api/orders/${zOrder.reference}/submitted`, { email: buyer.email })).status, 200);
    assert.equal((await call('POST', `/api/orders/${zOrder.reference}/cancel`, { email: buyer.email })).status, 409, 'cannot cancel after saying it was sent');
    const list = (await call('GET', '/api/admin/orders')).json; assert.equal(list.data[0].reference, zOrder.reference); assert.equal(list.data[0].payment_note, 'conf 12345');
    assert.ok((await call('GET', '/api/admin/stats')).json.payments_to_check >= 1);
  });
  await t('admin marks it paid, then fulfilled; customer sees it; a cancelled order cannot be reopened', async () => {
    const [[row]] = await db.query('SELECT id FROM orders WHERE reference = ?', [zOrder.reference]);
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'paid' })).json.status, 'paid');
    assert.equal((await call('GET', `/api/orders/${zOrder.reference}?email=${buyer.email}`)).json.status, 'paid');
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'fulfilled' })).json.status, 'fulfilled');
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'sideways' })).status, 422);
    assert.equal((await call('DELETE', `/api/admin/orders/${row.id}`)).status, 409, 'only cancelled orders can be deleted');
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'cancelled' })).json.status, 'cancelled');
    assert.equal(await stockOf(prod.balm), 10); assert.equal(await stockOf(prod.tee), 1);
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'paid' })).status, 409);
    assert.equal((await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'cancelled' })).status, 200, 'cancelling twice does not add stock twice');
    assert.equal(await stockOf(prod.balm), 10);
    assert.equal((await call('DELETE', `/api/admin/orders/${row.id}`)).status, 204);
  });
  await t('customer cancels an unpaid order: stock returns; second cancel is harmless', async () => {
    const o = (await call('POST', '/api/orders', { ...buyer, method: 'zelle', items: [{ product_id: prod.balm, qty: 3 }] })).json;
    assert.equal(await stockOf(prod.balm), 7);
    assert.equal((await call('POST', `/api/orders/${o.reference}/cancel`, { email: buyer.email })).json.status, 'cancelled');
    assert.equal(await stockOf(prod.balm), 10);
    await call('POST', `/api/orders/${o.reference}/cancel`, { email: buyer.email }); assert.equal(await stockOf(prod.balm), 10);
  });
  await t('unpaid orders older than a day are cancelled and give stock back', async () => {
    const o = (await call('POST', '/api/orders', { ...buyer, method: 'chime', items: [{ product_id: prod.balm, qty: 4 }] })).json;
    assert.equal(await stockOf(prod.balm), 6);
    await db.query("UPDATE orders SET created_at = datetime('now','-2 days') WHERE reference = ?", [o.reference]);
    assert.ok((await orders.expireStale()) >= 1);
    assert.equal((await call('GET', `/api/orders/${o.reference}?email=${buyer.email}`)).json.status, 'cancelled'); assert.equal(await stockOf(prod.balm), 10);
  });

  console.log('\nBitcoin');
  await t('bitcoin order: exact amount from the live rate (rounded up), address, URI and QR code', async () => {
    fake.rate = '50000.00'; pay.resetRateCache();
    const r = await call('POST', '/api/orders', { ...buyer, method: 'bitcoin', items: [{ product_id: prod.balm, qty: 1 }] });
    assert.equal(r.status, 201); const p = r.json.payment;
    assert.equal(p.type, 'bitcoin'); assert.equal(p.btc, '0.00036000'); assert.equal(p.address, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    assert.ok(p.uri.startsWith('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00036000')); assert.ok(p.qr.startsWith('data:image/png;base64,'));
    // a price that does not divide evenly is rounded UP, never down
    assert.equal((await pay.btcQuote(10000)).sats, 200000); fake.rate = '30000.00'; pay.resetRateCache(); assert.equal((await pay.btcQuote(1000)).sats, 33334);
    // the admin changes the wallet later: this order still shows the address it was given
    await call('PUT', '/api/admin/payments/bitcoin', { label: 'bitcoin', enabled: 1, account: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', instructions: '' });
    assert.equal((await call('GET', `/api/orders/${r.json.reference}?email=${buyer.email}`)).json.payment.address, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    await call('PUT', '/api/admin/payments/bitcoin', { label: 'bitcoin', enabled: 1, account: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', instructions: '' });
    await call('POST', `/api/orders/${r.json.reference}/cancel`, { email: buyer.email });
  });
  await t('bitcoin price service down: refused (503), no order left behind, stock returned', async () => {
    fake.rateDown = true; pay.resetRateCache();
    const before = await stockOf(prod.balm);
    const r = await call('POST', '/api/orders', { ...buyer, method: 'bitcoin', items: [{ product_id: prod.balm, qty: 2 }] });
    fake.rateDown = false; pay.resetRateCache();
    assert.equal(r.status, 503); assert.equal(await stockOf(prod.balm), before);
    assert.equal((await db.query("SELECT COUNT(*) n FROM orders WHERE status = 'awaiting_payment' AND method = 'bitcoin'"))[0][0].n, 0);
  });

  console.log('\nCard payments (Stripe, simulated)');
  let cOrder, session;
  await t('card order creates a hosted payment page with the right amounts', async () => {
    const r = await call('POST', '/api/orders', { ...buyer, method: 'card', items: [{ product_id: prod.balm, qty: 2 }, { product_id: prod.gift, qty: 1 }] });
    assert.equal(r.status, 201); cOrder = r.json; assert.equal(cOrder.payment.type, 'redirect'); assert.ok(cOrder.payment.url.startsWith('https://checkout.stripe.test/'));
    session = [...fake.sessions.values()].pop();
    assert.equal(session.amount_total, 1800 * 2 + 10000); assert.equal(session.client_reference_id, cOrder.reference);
    assert.equal(fake.lastForm.get('customer_email'), buyer.email);
    assert.ok(fake.lastForm.get('success_url').includes(cOrder.reference));
  });
  await t('card order stays unpaid until Stripe says paid; a wrong amount is NOT accepted', async () => {
    assert.equal((await call('GET', `/api/orders/${cOrder.reference}?email=${buyer.email}`)).json.status, 'awaiting_payment');
    session.payment_status = 'paid'; session.amount_total = 100;
    assert.equal((await call('GET', `/api/orders/${cOrder.reference}?email=${buyer.email}`)).json.status, 'awaiting_payment', 'underpaid session must not mark the order paid');
    session.amount_total = 1800 * 2 + 10000;
    assert.equal((await call('GET', `/api/orders/${cOrder.reference}?email=${buyer.email}`)).json.status, 'paid');
    assert.equal((await call('POST', `/api/orders/${cOrder.reference}/submitted`, { email: buyer.email })).status, 409);
  });
  const sign = (body, secret = 'whsec_test_secret', t0 = Math.floor(Date.now() / 1000)) => `t=${t0},v1=${crypto.createHmac('sha256', secret).update(`${t0}.${body}`).digest('hex')}`;
  const hook = (body, sig) => fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body });
  await t('webhook: only a correctly signed, fresh request can mark an order paid', async () => {
    const o = (await call('POST', '/api/orders', { ...buyer, method: 'card', items: [{ product_id: prod.gift, qty: 1 }] })).json;
    const s = [...fake.sessions.values()].pop();
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { ...s, payment_status: 'paid' } } });
    const status = async () => (await call('GET', `/api/admin/orders?q=${o.reference}`)).json.data[0].status;
    assert.equal((await hook(body, 't=1,v1=abc')).status, 400);
    assert.equal((await hook(body, sign(body, 'whsec_wrong'))).status, 400);
    assert.equal((await hook(body, sign(body, 'whsec_test_secret', Math.floor(Date.now() / 1000) - 3600))).status, 400, 'old signatures (replay) are refused');
    assert.equal((await hook(body.replace('paid', 'paid '), sign(body))).status, 400, 'a changed body is refused');
    assert.equal((await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400);
    assert.equal(await status(), 'awaiting_payment');
    assert.equal((await hook(body, sign(body))).status, 200); assert.equal(await status(), 'paid');
    assert.equal((await hook(body, sign(body))).status, 200); assert.equal(await status(), 'paid', 'repeat delivery is harmless');
    const wrong = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_unknown', client_reference_id: o.reference, payment_status: 'paid', amount_total: 1, currency: 'usd' } } });
    assert.equal((await hook(wrong, sign(wrong))).status, 200);
  });
  await t('webhook: an expired session cancels the order and returns the stock', async () => {
    const before = await stockOf(prod.balm);
    const o = (await call('POST', '/api/orders', { ...buyer, method: 'card', items: [{ product_id: prod.balm, qty: 2 }] })).json;
    const s = [...fake.sessions.values()].pop(); assert.equal(await stockOf(prod.balm), before - 2);
    const body = JSON.stringify({ type: 'checkout.session.expired', data: { object: { ...s, status: 'expired' } } });
    assert.equal((await hook(body, sign(body))).status, 200);
    assert.equal((await call('GET', `/api/orders/${o.reference}?email=${buyer.email}`)).json.status, 'cancelled'); assert.equal(await stockOf(prod.balm), before);
  });
  await t('Stripe down: card refused (502), no order left behind, stock returned', async () => {
    const before = await stockOf(prod.balm); fake.stripeDown = true;
    const r = await call('POST', '/api/orders', { ...buyer, method: 'card', items: [{ product_id: prod.balm, qty: 1 }] });
    fake.stripeDown = false; assert.equal(r.status, 502); assert.equal(await stockOf(prod.balm), before);
  });
  await t('card cannot be switched on without a Stripe key', async () => {
    const key = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = '';
    assert.equal((await call('PUT', '/api/admin/payments/card', { label: 'card', enabled: 1 })).status, 422);
    assert.deepEqual((await call('GET', '/api/payment-methods')).json.map(m => m.method), ['zelle', 'chime', 'bitcoin'], 'card disappears from the site while no key is set');
    process.env.STRIPE_SECRET_KEY = key;
  });

  console.log('\nBooking deposits');
  await t('deposit: needs reference + email, uses the size\'s deposit, none without a size', async () => {
    assert.equal((await call('POST', `/api/bookings/${depRef}/deposit`, { email: 'wrong@example.com', method: 'zelle' })).status, 404);
    const [[nb]] = await db.query("SELECT reference FROM bookings WHERE email = 'dep2@example.com'");
    assert.equal((await call('POST', `/api/bookings/${nb.reference}/deposit`, { email: 'dep2@example.com', method: 'zelle' })).status, 409);
    const r = await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'zelle' });
    assert.equal(r.status, 201); assert.equal(r.json.kind, 'deposit'); assert.equal(r.json.total_cents, 25000); assert.equal(r.json.payment.amount_cents, 25000);
    // switching method replaces the earlier unpaid attempt
    const r2 = await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'bitcoin' }); assert.equal(r2.status, 201);
    assert.equal((await call('GET', `/api/orders/${r.json.reference}?email=${depEmail}`)).json.status, 'cancelled');
    // pay it by card (simulated)
    const r3 = await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'card' }); assert.equal(r3.status, 201);
    const s = [...fake.sessions.values()].pop(); assert.equal(s.amount_total, 25000); s.payment_status = 'paid';
    assert.equal((await call('GET', `/api/orders/${r3.json.reference}?email=${depEmail}`)).json.status, 'paid');
    assert.equal((await call('GET', `/api/bookings/${depRef}?email=${depEmail}`)).json.deposit_paid, true);
    assert.equal((await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'zelle' })).status, 409, 'cannot pay twice');
    const adminRow = (await call('GET', `/api/admin/bookings?q=${depRef}`)).json.data[0]; assert.equal(adminRow.deposit_paid, 1); assert.equal(adminRow.deposit_cents, 25000);
    // refund: cancelling the paid deposit order clears the paid flag
    const [[o]] = await db.query('SELECT id FROM orders WHERE reference = ?', [r3.json.reference]);
    await call('PATCH', `/api/admin/orders/${o.id}`, { status: 'cancelled' });
    assert.equal((await call('GET', `/api/bookings/${depRef}?email=${depEmail}`)).json.deposit_paid, false);
  });
  await t('deposit paid by hand (Zelle): customer says sent, admin confirms, booking shows paid', async () => {
    const r = (await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'zelle' })).json;
    assert.equal((await call('POST', `/api/orders/${r.reference}/submitted`, { email: depEmail })).json.status, 'payment_submitted');
    assert.equal((await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'chime' })).status, 409, 'a deposit already being checked is not duplicated');
    const [[o]] = await db.query('SELECT id FROM orders WHERE reference = ?', [r.reference]);
    await call('PATCH', `/api/admin/orders/${o.id}`, { status: 'paid' });
    assert.equal((await call('GET', `/api/bookings/${depRef}?email=${depEmail}`)).json.deposit_paid, true);
    const mix = (await call('GET', '/api/admin/orders?kind=deposit')).json; assert.ok(mix.data.every(x => x.kind === 'deposit'));
  });
  await t('admin order, product, tier and payment routes need sign-in (401)', async () => {
    for (const [m, u] of [['GET', '/api/admin/orders'], ['PATCH', '/api/admin/orders/1'], ['DELETE', '/api/admin/orders/1'], ['GET', '/api/admin/payments'], ['PUT', '/api/admin/payments/zelle'], ['POST', '/api/admin/products'], ['POST', '/api/admin/tiers'], ['DELETE', '/api/admin/products/1']]) {
      const r = await call(m, u, m === 'GET' ? undefined : {}, { auth: false }); assert.equal(r.status, 401, `${m} ${u} gave ${r.status}`);
    }
  });
  await t('product cleanup: delete removes its photo file', async () => {
    const [[p]] = await db.query('SELECT image FROM products WHERE id = ?', [prod.balm]); const file = path.join(uploads, path.basename(p.image)); assert.ok(fs.existsSync(file));
    for (const id of Object.values(prod)) assert.equal((await call('DELETE', `/api/admin/products/${id}`)).status, 204);
    await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file));
  });

  console.log('\nCustomer emails');
  const mailer = require('../src/lib/mailer');
  const waitMail = async (pred, ms = 3000) => { const t0 = Date.now(); for (;;) { const m = mailer.outbox.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('no matching email arrived. Outbox: ' + mailer.outbox.map(x => x.to + ' | ' + x.subject).join(' ; ')); await new Promise(r => setTimeout(r, 40)); } };
  await t('booking received: email with reference, size, date and deposit steps (HTML and plain text)', async () => {
    mailer.outbox.length = 0;
    const [[small]] = await db.query("SELECT id FROM price_tiers WHERE name = 'Small tattoo'");
    const r = await call('POST', '/api/bookings', { name: 'Mia <b>Mail</b>', phone: '+1 555 777 8888', email: 'mia@example.com', tier_id: small.id, date: nextWeekday(45), artist_id: laura.id });
    assert.equal(r.status, 201);
    const m = await waitMail(x => x.to === 'mia@example.com' && /Booking request received/.test(x.subject));
    assert.ok(m.subject.includes(r.json.reference)); assert.ok(m.text.includes('Small tattoo') && m.text.includes('$200 DEPOSIT') && m.text.includes(r.json.reference));
    assert.ok(m.html.includes('Mia &lt;b&gt;Mail&lt;/b&gt;') && !m.html.includes('<b>Mail</b>'), 'names are escaped in the HTML');
    assert.ok(m.html.startsWith('<!doctype html>'));
    const am = await waitMail(x => x.to === 'studio@example.com' && /New booking request/.test(x.subject));
    assert.ok(am.subject.includes(r.json.reference) && am.text.includes('Small tattoo') && am.text.includes('mia@example.com'), 'the studio gets its own copy');
  });
  await t('no-size booking email has no deposit section; a failed booking sends no email', async () => {
    mailer.outbox.length = 0;
    await call('POST', '/api/bookings', { name: 'Nia NoSize', phone: '+1 555 777 9999', email: 'nia@example.com', date: nextWeekday(46), artist_id: laura.id });
    const m = await waitMail(x => x.to === 'nia@example.com'); assert.ok(!/deposit/i.test(m.text));
    mailer.outbox.length = 0; await call('POST', '/api/bookings', { name: 'X', email: 'bad' }); await new Promise(r => setTimeout(r, 300)); assert.equal(mailer.outbox.length, 0);
  });
  // products for the order emails
  const mp = (await call('POST', '/api/admin/products', form({ name: 'Mail Balm', price_cents: '18', stock: 20, sort_order: 60, active: 1 }))).json.id;
  const mailBuyer = { name: 'Eli Mail', email: 'eli@example.com' };
  await t('payment reserved: Zelle email says what to send, where, and the code to write', async () => {
    mailer.outbox.length = 0;
    const o = (await call('POST', '/api/orders', { ...mailBuyer, method: 'zelle', items: [{ product_id: mp, qty: 2 }] })).json;
    const m = await waitMail(x => x.to === 'eli@example.com' && /Payment reserved/.test(x.subject));
    assert.ok(m.subject.includes(o.reference)); for (const s of ['pay@inknation.example', '$36', o.reference, '24 hours', 'I have sent the payment']) assert.ok(m.text.includes(s), 'missing: ' + s);
    assert.equal(m.replyTo, 'a@b.cd', 'replies go to the studio email');
    const am = await waitMail(x => x.to === 'studio@example.com' && /Payment reserved/.test(x.subject) && x.text.includes(o.reference));
    assert.ok(am.text.includes('zelle') && am.text.includes('$36'), 'the studio is told about the reservation');
  });
  await t('payment reserved: Bitcoin and card emails carry the amount/address and the pay link', async () => {
    mailer.outbox.length = 0; fake.rate = '50000.00'; pay.resetRateCache();
    await call('POST', '/api/orders', { ...mailBuyer, method: 'bitcoin', items: [{ product_id: mp, qty: 1 }] });
    const b = await waitMail(x => x.to === 'eli@example.com' && /Payment reserved/.test(x.subject)); assert.ok(b.text.includes('0.00036000 BTC') && b.text.includes('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'));
    mailer.outbox.length = 0;
    const c = (await call('POST', '/api/orders', { ...mailBuyer, method: 'card', items: [{ product_id: mp, qty: 1 }] })).json;
    const cm = await waitMail(x => x.to === 'eli@example.com' && /Payment reserved/.test(x.subject)); assert.ok(cm.text.includes(c.payment.url) && cm.html.includes(c.payment.url));
    await waitMail(x => x.to === 'studio@example.com' && /Payment reserved/.test(x.subject) && x.text.includes(c.reference));
  });
  await t('payment reserved for a booking deposit says so', async () => {
    mailer.outbox.length = 0;
    const o = (await call('POST', `/api/bookings/${depRef}/deposit`, { email: depEmail, method: 'chime' }));
    assert.equal(o.status, 409, 'deposit already paid in earlier test, so no second one: ' + o.status);
    const [[b]] = await db.query("SELECT reference, email FROM bookings WHERE email = 'mia@example.com'");
    const r = await call('POST', `/api/bookings/${b.reference}/deposit`, { email: b.email, method: 'chime' }); assert.equal(r.status, 201);
    const m = await waitMail(x => x.to === 'mia@example.com' && /Payment reserved/.test(x.subject)); assert.ok(m.text.includes('booking deposit') && m.text.includes('$200') && m.text.includes('$inknation'));
    await waitMail(x => x.to === 'studio@example.com' && /Payment reserved/.test(x.subject) && x.text.includes(r.json.reference));
  });
  await t('payment received: email when the studio marks it paid, and when Stripe confirms; not twice', async () => {
    const [[row]] = await db.query("SELECT id, reference FROM orders WHERE email = 'eli@example.com' AND method = 'zelle' ORDER BY id DESC LIMIT 1");
    mailer.outbox.length = 0;
    await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'paid' });
    const m = await waitMail(x => x.to === 'eli@example.com' && /Payment received/.test(x.subject)); assert.ok(m.text.includes('$36') && m.text.includes(row.reference));
    const am = await waitMail(x => x.to === 'studio@example.com' && /Payment received/.test(x.subject) && x.text.includes(row.reference));
    assert.ok(am.text.includes('$36'), 'the studio is told about the payment');
    await call('PATCH', `/api/admin/orders/${row.id}`, { status: 'fulfilled' }); await new Promise(r => setTimeout(r, 300));
    assert.equal(mailer.outbox.filter(x => x.to === 'eli@example.com' && /Payment received/.test(x.subject)).length, 1, 'only one "received" email');
    assert.equal(mailer.outbox.filter(x => x.to === 'studio@example.com' && /Payment received/.test(x.subject)).length, 1, 'only one studio copy');
    // Stripe path
    mailer.outbox.length = 0;
    const c = (await call('POST', '/api/orders', { ...mailBuyer, method: 'card', items: [{ product_id: mp, qty: 1 }] })).json;
    const s = [...fake.sessions.values()].pop(); s.payment_status = 'paid';
    await call('GET', `/api/orders/${c.reference}?email=${mailBuyer.email}`);
    await waitMail(x => x.to === 'eli@example.com' && /Payment received/.test(x.subject) && x.text.includes(c.reference));
    await waitMail(x => x.to === 'studio@example.com' && /Payment received/.test(x.subject) && x.text.includes(c.reference));
    // deposit paid by studio
    const [[b]] = await db.query("SELECT reference, email FROM bookings WHERE email = 'mia@example.com'");
    const [[d]] = await db.query("SELECT id FROM orders WHERE email = 'mia@example.com' AND status = 'awaiting_payment' LIMIT 1");
    mailer.outbox.length = 0; await call('PATCH', `/api/admin/orders/${d.id}`, { status: 'paid' });
    const dm = await waitMail(x => x.to === 'mia@example.com' && /Payment received/.test(x.subject)); assert.ok(dm.text.includes('deposit') && dm.text.includes(b.reference));
    await waitMail(x => x.to === 'studio@example.com' && /Payment received/.test(x.subject) && x.text.includes(b.reference));
  });
  await t('email trouble never breaks the customer: unset SMTP returns false quietly', async () => {
    // Real .env settings must not leak into this check (or a real email could be sent), so hide them for this test.
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'MAIL_FROM'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    const was = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; const w = console.warn; let warned = 0; console.warn = () => warned++;
    try {
      keys.forEach(k => { delete process.env[k]; });
      assert.equal(await mailer.send({ to: 'x@example.com', subject: 's', text: 't' }), false);
    } finally {
      process.env.NODE_ENV = was; console.warn = w;
      keys.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    }
    assert.ok(warned <= 1);
  });
  await call('DELETE', `/api/admin/products/${mp}`);

  console.log('\nStudio video');
  await t('studio video: MP4 accepted and public, fake file refused, too big refused, remove deletes the file', async () => {
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(200, 7)]);
    const vf = (buf, name = 'v.mp4') => { const f = new FormData(); f.append('video', new Blob([buf], { type: 'video/mp4' }), name); return f; };
    assert.equal((await call('POST', '/api/admin/studio/video', new FormData())).status, 400);
    assert.equal((await call('POST', '/api/admin/studio/video', vf(Buffer.from('<html>not a video at all</html>')))).status, 400);
    assert.equal((await call('POST', '/api/admin/studio/video', vf(Buffer.concat([MP4, Buffer.alloc(31 * 1024 * 1024)])))).status, 413);
    const ok = await call('POST', '/api/admin/studio/video', vf(MP4)); assert.equal(ok.status, 200); assert.match(ok.json.team_video, /^\/uploads\/[a-f0-9]+\.mp4$/);
    assert.equal((await call('GET', '/api/studio', undefined, { auth: false })).json.team_video, ok.json.team_video);
    const file = path.join(uploads, path.basename(ok.json.team_video)); assert.ok(fs.existsSync(file));
    const ok2 = await call('POST', '/api/admin/studio/video', vf(MP4)); await new Promise(r => setTimeout(r, 100)); assert.ok(!fs.existsSync(file), 'replacing removes the old file');
    assert.equal((await call('DELETE', '/api/admin/studio/video')).status, 204); await new Promise(r => setTimeout(r, 100));
    assert.ok(!fs.existsSync(path.join(uploads, path.basename(ok2.json.team_video)))); assert.equal((await call('GET', '/api/studio')).json.team_video, '');
    assert.equal((await call('POST', '/api/admin/studio/video', vf(MP4), { auth: false })).status, 401);
  });

  const withEnv = async (vars, fn) => { const was = {}; for (const k of Object.keys(vars)) { was[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; } } };

  console.log('\nUploads kept in the database (for hosts that erase their disk)');
  await withEnv({ UPLOAD_STORAGE: 'db' }, async () => {
    const BIG = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(2.5 * 1024 * 1024 + 123)].map((b, i) => i === 2 ? b.fill(9) : b)); // about 11 pieces of 256 KB
    let imgUrl, vidUrl;
    await t('photo is saved in the database (not in /uploads), and served with the right type and exact bytes', async () => {
      const before = fs.readdirSync(uploads).length;
      const h = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: PNG })); assert.equal(h.status, 200);
      imgUrl = h.json.hero_image; assert.match(imgUrl, /^\/uploads\/[a-f0-9]{24}\.png$/);
      assert.equal(fs.readdirSync(uploads).length, before, 'nothing written to disk');
      const r = await fetch(base + imgUrl); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
      assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
      assert.match(r.headers.get('cache-control'), /max-age=604800/);
    });
    await t('video is cut into pieces, played back in ranges (Safari needs this), wrong ranges refused', async () => {
      const f = new FormData(); f.append('video', new Blob([BIG], { type: 'video/mp4' }), 'v.mp4');
      const up = await call('POST', '/api/admin/studio/video', f); assert.equal(up.status, 200); vidUrl = up.json.team_video; assert.match(vidUrl, /\.mp4$/);
      const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM ink_files WHERE name = ?', [path.basename(vidUrl)]); assert.equal(n, Math.ceil(BIG.length / (256 * 1024)));
      const all = await fetch(base + vidUrl); assert.equal(all.status, 200); assert.equal(all.headers.get('accept-ranges'), 'bytes'); assert.ok(Buffer.from(await all.arrayBuffer()).equals(BIG));
      const r1 = await fetch(base + vidUrl, { headers: { Range: 'bytes=0-1' } }); assert.equal(r1.status, 206); assert.equal(r1.headers.get('content-range'), `bytes 0-1/${BIG.length}`); assert.equal((await r1.arrayBuffer()).byteLength, 2);
      const r2 = await fetch(base + vidUrl, { headers: { Range: `bytes=${BIG.length - 10}-` } }); assert.equal(r2.status, 206); assert.ok(Buffer.from(await r2.arrayBuffer()).equals(BIG.subarray(BIG.length - 10)));
      const r3 = await fetch(base + vidUrl, { headers: { Range: 'bytes=-5' } }); assert.equal(r3.status, 206); assert.equal((await r3.arrayBuffer()).byteLength, 5);
      const r4 = await fetch(base + vidUrl, { headers: { Range: `bytes=${BIG.length + 5}-` } }); assert.equal(r4.status, 416);
      const edge = 256 * 1024; const mid = await fetch(base + vidUrl, { headers: { Range: `bytes=${edge - 2}-${edge + 1}` } }); assert.ok(Buffer.from(await mid.arrayBuffer()).equals(BIG.subarray(edge - 2, edge + 2)), 'a range across two pieces is exact');
    });
    await t('a file that is an exact multiple of the group size is read completely', async () => {
      const exact = Buffer.concat([PNG, Buffer.alloc(4 * 256 * 1024 - PNG.length, 5)]); // exactly 4 pieces
      const h = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: exact }));
      assert.equal(h.status, 200); const r = await fetch(base + h.json.hero_image); assert.ok(Buffer.from(await r.arrayBuffer()).equals(exact));
      imgUrl = h.json.hero_image;
    });
    await t('unknown or odd names give 404, never an error or a file from elsewhere', async () => {
      for (const u of ['/uploads/000000000000000000000000.png', '/uploads/..%2Fserver.js', '/uploads/abc.png', '/uploads/' + 'a'.repeat(24) + '.exe']) assert.equal((await fetch(base + u)).status, 404, u);
    });
    await t('removing the photo and the video deletes their rows; files already on disk still work', async () => {
      assert.equal((await call('DELETE', '/api/admin/studio/hero')).status, 204); assert.equal((await call('DELETE', '/api/admin/studio/video')).status, 204);
      assert.equal((await fetch(base + imgUrl)).status, 404); assert.equal((await fetch(base + vidUrl)).status, 404);
      const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM ink_files'); assert.equal(n, 0, 'no pieces left behind');
      const old = crypto.randomBytes(12).toString('hex') + '.png'; fs.writeFileSync(path.join(uploads, old), PNG);
      assert.equal((await fetch(base + '/uploads/' + old)).status, 200);
    });
    await t('a photo made by a booking form also lives in the database and is deleted with the booking', async () => {
      const f = form({ name: 'Photo Person', phone: '+237 600 000 077', email: 'photo@example.com', piece: 'Half sleeve', date: nextWeekday(20, 3), artist_id: laura.id }, { field: 'reference_image', buffer: PNG });
      const r = await call('POST', '/api/bookings', f, { auth: false }); assert.equal(r.status, 201, JSON.stringify(r.json));
      const [[b]] = await db.query('SELECT id, reference_image FROM bookings WHERE reference = ?', [r.json.reference]);
      assert.equal((await fetch(base + b.reference_image)).status, 200);
      assert.equal((await call('DELETE', `/api/admin/bookings/${b.id}`)).status, 204);
      assert.equal((await fetch(base + b.reference_image)).status, 404);
    });
  });

  console.log('\nEmail through Brevo (for hosts that block SMTP)');
  await t('with BREVO_API_KEY the email goes out over the web API with the right sender, recipient and content', async () => {
    await withEnv({ NODE_ENV: 'production', BREVO_API_KEY: 'xkeysib-test', BREVO_API_URL: process.env.STRIPE_API_BASE + '/brevo', MAIL_FROM: 'Ink Nation <hello@inknation.example>', SMTP_HOST: undefined }, async () => {
      assert.equal(mailer.configured(), true);
      assert.equal(await mailer.send({ to: 'mia@example.com', subject: 'Hello', text: 'plain', html: '<p>rich</p>', replyTo: 'Studio <studio@inknation.example>' }), true);
      assert.equal(fake.brevo.key, 'xkeysib-test');
      assert.deepEqual(fake.brevo.body, { sender: { name: 'Ink Nation', email: 'hello@inknation.example' }, to: [{ email: 'mia@example.com' }], subject: 'Hello', textContent: 'plain', htmlContent: '<p>rich</p>', replyTo: { name: 'Studio', email: 'studio@inknation.example' } });
    });
  });
  await t('Brevo refusing the key is logged and returns false, it never throws into a booking', async () => {
    fake.brevoDown = true; const e = console.error; let logged = '';
    console.error = m => { logged += m; };
    try {
      await withEnv({ NODE_ENV: 'production', BREVO_API_KEY: 'bad', BREVO_API_URL: process.env.STRIPE_API_BASE + '/brevo', MAIL_FROM: 'hello@inknation.example' }, async () => assert.equal(await mailer.send({ to: 'x@example.com', subject: 's', text: 't' }), false));
    } finally { console.error = e; fake.brevoDown = false; }
    assert.match(logged, /Brevo answered 401/);
  });

  console.log('\nPhotos and video on Cloudinary (fast CDN)');
  {
    const cl = { uploads: [], destroyed: [], n: 0 };
    const clServer = http.createServer((req, res) => {
      const parts = []; req.on('data', c => parts.push(c)); req.on('end', async () => {
        const body = Buffer.concat(parts);
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const m = /^\/v1_1\/demo\/(image|video)\/(upload|destroy)$/.exec(req.url);
        if (!m) return send(404, { error: { message: 'nope' } });
        const fd = m[2] === 'upload' ? await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData() : new URLSearchParams(body.toString());
        const params = {}; for (const [k, v] of fd.entries()) if (!['file', 'api_key', 'signature'].includes(k)) params[k] = v;
        const good = fd.get('api_key') === 'key123' && fd.get('signature') === cloudSign(params, 'secret456');
        if (!good) return send(401, { error: { message: 'Invalid Signature' } });
        if (m[2] === 'destroy') { cl.destroyed.push(m[1] + ':' + fd.get('public_id')); return send(200, { result: 'ok' }); }
        const file = fd.get('file'); const id = 'f' + (++cl.n);
        cl.uploads.push({ kind: m[1], folder: fd.get('folder'), size: file.size });
        send(200, { public_id: 'ink-nation/' + id, version: 1700000000 + cl.n, format: m[1] === 'video' ? 'mp4' : 'png', resource_type: m[1] });
      });
    });
    const cloudSign = require('../src/lib/cloudinary').sign;
    await new Promise(r => clServer.listen(0, '127.0.0.1', r));
    const CDN = 'https://res.cloudinary.com/demo/';
    await withEnv({ CLOUDINARY_URL: 'cloudinary://key123:secret456@demo', CLOUDINARY_API_BASE: 'http://127.0.0.1:' + clServer.address().port }, async () => {
      let heroUrl, workId;
      await t('a photo goes to Cloudinary with a valid signature, nothing is written to disk or the database', async () => {
        const before = fs.readdirSync(uploads).length; const [[{ n: rows }]] = await db.query('SELECT COUNT(*) n FROM ink_files');
        const r = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: PNG })); assert.equal(r.status, 200, JSON.stringify(r.json));
        heroUrl = r.json.hero_image; assert.match(heroUrl, /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/f_auto,q_auto,c_limit,w_2000\/v\d+\/ink-nation\/f\d+\.png$/);
        assert.equal(cl.uploads.at(-1).folder, 'ink-nation'); assert.equal(cl.uploads.at(-1).size, PNG.length);
        assert.equal(fs.readdirSync(uploads).length, before); const [[{ n: after }]] = await db.query('SELECT COUNT(*) n FROM ink_files'); assert.equal(after, rows);
        assert.equal((await call('GET', '/api/studio')).json.hero_image, heroUrl);
      });
      await t('replacing and deleting photos removes the old file from Cloudinary', async () => {
        const r = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: PNG })); assert.equal(r.status, 200);
        assert.ok(cl.destroyed.includes('image:' + heroUrl.split('/').slice(-2).join('/').replace(/\.png$/, '')), 'old hero destroyed');
        const w = await call('POST', '/api/admin/works', form({ title: 'Cloud piece', description: 'D', art_key: 'rose' }, { field: 'image', buffer: PNG })); assert.equal(w.status, 201); workId = w.json.id;
        assert.ok(w.json.image.startsWith(CDN));
        assert.equal((await call('DELETE', '/api/admin/works/' + workId)).status, 204);
        assert.ok(cl.destroyed.some(d => w.json.image.includes(d.slice(6))));
        await call('DELETE', '/api/admin/studio/hero');
      });
      await t('a fake image is still refused before anything is sent to Cloudinary', async () => {
        const n = cl.uploads.length; const r = await call('POST', '/api/admin/studio/hero', form({}, { field: 'image', buffer: Buffer.alloc(100, 7) }));
        assert.equal(r.status, 400); assert.equal(cl.uploads.length, n);
      });
      await t('the video is delivered as compressed MP4 (server upload and direct browser upload)', async () => {
        const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(500, 3)]);
        const f = new FormData(); f.append('video', new Blob([MP4], { type: 'video/mp4' }), 'v.mp4');
        const up = await call('POST', '/api/admin/studio/video', f); assert.equal(up.status, 200);
        assert.match(up.json.team_video, /^https:\/\/res\.cloudinary\.com\/demo\/video\/upload\/q_auto,c_limit,w_1280\/v\d+\/ink-nation\/f\d+\.mp4$/);
        assert.equal((await call('GET', '/api/admin/media')).json.direct_video, true);
        const sig = await call('POST', '/api/admin/studio/video/sign'); assert.equal(sig.status, 200);
        const bf = new FormData(); for (const [k, v] of Object.entries(sig.json.fields)) bf.append(k, v); bf.append('file', new Blob([MP4]), 'v.mp4');
        const cr = await (await fetch(sig.json.url, { method: 'POST', body: bf })).json(); assert.equal(cr.resource_type, 'video', 'signature accepted by Cloudinary');
        const d = await call('POST', '/api/admin/studio/video/direct', cr); assert.equal(d.status, 200); assert.ok(d.json.team_video.endsWith(cr.public_id + '.mp4'));
        assert.ok(cl.destroyed.includes('video:' + up.json.team_video.split('/').slice(-2).join('/').replace(/\.mp4$/, '')), 'previous video destroyed');
        for (const bad of [{ ...cr, public_id: 'other/x' }, { ...cr, resource_type: 'image' }, { ...cr, public_id: 'ink-nation/../x' }, {}]) assert.equal((await call('POST', '/api/admin/studio/video/direct', bad)).status, 400);
        assert.equal((await call('POST', '/api/admin/studio/video/sign', undefined, { auth: false })).status, 401);
        await call('DELETE', '/api/admin/studio/video');
      });
      await t('older photos (database or disk) are moved to Cloudinary in one click and every row is updated', async () => {
        const disk = crypto.randomBytes(12).toString('hex') + '.png'; fs.writeFileSync(path.join(uploads, disk), PNG);
        const inDb = crypto.randomBytes(12).toString('hex') + '.png';
        await withEnv({ UPLOAD_STORAGE: 'db' }, () => require('../src/lib/images').putFile(inDb, PNG));
        const w = await call('POST', '/api/admin/works', form({ title: 'Old piece', description: 'D', art_key: 'rose' })); assert.equal(w.status, 201);
        await db.query('UPDATE works SET image = ? WHERE id = ?', ['/uploads/' + disk, w.json.id]);
        await db.query("INSERT INTO settings (k, v) VALUES ('hero_image', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", ['/uploads/' + inDb]);
        assert.equal((await call('GET', '/api/admin/media')).json.to_move, 2);
        const mv = await call('POST', '/api/admin/media/move'); assert.equal(mv.status, 200); assert.equal(mv.json.moved, 2, JSON.stringify(mv.json));
        const [[row]] = await db.query('SELECT image FROM works WHERE id = ?', [w.json.id]); assert.ok(row.image.startsWith(CDN));
        assert.ok((await call('GET', '/api/studio')).json.hero_image.startsWith(CDN));
        const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM ink_files WHERE name = ?', [inDb]); assert.equal(n, 0, 'database copy freed');
        assert.equal((await call('GET', '/api/admin/media')).json.to_move, 0);
        await call('DELETE', '/api/admin/works/' + w.json.id); await call('DELETE', '/api/admin/studio/hero'); fs.rmSync(path.join(uploads, disk), { force: true });
      });
    });
    clServer.close();
  }

  console.log('\nThe address Stripe sends customers back to');
  await t('a local APP_URL is ignored on Render, so paying never ends on localhost', async () => {
    await withEnv({ APP_URL: 'http://localhost:3000', RENDER_EXTERNAL_URL: 'https://ink-nation.onrender.com' }, () => assert.equal(pay.appUrl(), 'https://ink-nation.onrender.com'));
    await withEnv({ APP_URL: 'https://inknation.example/', RENDER_EXTERNAL_URL: 'https://ink-nation.onrender.com' }, () => assert.equal(pay.appUrl(), 'https://inknation.example'));
    await withEnv({ APP_URL: 'ink-nation.onrender.com', RENDER_EXTERNAL_URL: undefined }, () => assert.equal(pay.appUrl(), 'https://ink-nation.onrender.com'));
    await withEnv({ APP_URL: undefined, RENDER_EXTERNAL_URL: undefined, PORT: '3000' }, () => assert.equal(pay.appUrl(), 'http://localhost:3000'));
  });

  await t('sign out ends the session', async () => {
    await call('POST', '/api/admin/logout'); cookie = '';
    assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  });

  await db.query('DELETE FROM bookings'); await db.query('DELETE FROM inquiries'); await db.query('DELETE FROM orders'); await db.query('DELETE FROM reviews'); await db.query('DELETE FROM artist_photos');
  await db.query("UPDATE payment_methods SET enabled = 0, account = ''");
  for (const f of fs.readdirSync(uploads)) if (!keep.has(f)) fs.unlinkSync(path.join(uploads, f)); // only files this test created
  server.close(); fakeServer.close(); await db.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
