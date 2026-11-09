// Photos and the studio video on Cloudinary (free plan: 25 GB of storage and delivery a month).
// Why: a file kept inside Turso has to travel Render <- Turso in pieces on every view, and the free Render
// server forgets its cache each time it sleeps, so pages crawled and the video often never started.
// Cloudinary serves files from a worldwide CDN, shrinks photos to WebP/AVIF at the right size and compresses video.
//
// Switched on by one Render environment value, copied from the Cloudinary dashboard ("API environment variable"):
//   CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// Without it, files are stored as before (disk or database).
const crypto = require('crypto');
const { HttpError } = require('./errors');

const FOLDER = 'ink-nation';

function config() {
  const raw = (process.env.CLOUDINARY_URL || '').trim().replace(/^["']+|["']+$/g, '');
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@([^/?#\s]+)/.exec(raw);
  if (!m) return null;
  return { key: decodeURIComponent(m[1]), secret: decodeURIComponent(m[2]), cloud: m[3] };
}
const enabled = () => !!config();
const apiBase = () => ((process.env.CLOUDINARY_API_BASE || '').trim() || 'https://api.cloudinary.com').replace(/\/+$/, '');
const deliveryBase = cloud => `https://res.cloudinary.com/${cloud}`;

// Cloudinary's signature: the parameters sorted by name, joined with &, followed by the secret, hashed with SHA-1.
function sign(params, secret) {
  const s = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '').sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(s + secret).digest('hex');
}

// The address visitors load. Photos: best format for the browser (WebP/AVIF), automatic quality, never wider than 2000 px.
// Video: always MP4 (iPhones cannot play WebM), automatic quality, at most 1280 px wide; a 30 MB clip usually becomes 2 to 5 MB.
function deliveryUrl(cloud, kind, r) {
  if (kind === 'video') return `${deliveryBase(cloud)}/video/upload/q_auto,c_limit,w_1280/v${r.version}/${r.public_id}.mp4`;
  return `${deliveryBase(cloud)}/image/upload/f_auto,q_auto,c_limit,w_2000/v${r.version}/${r.public_id}.${r.format}`;
}

// Sends the bytes from the server to Cloudinary. Returns the delivery URL.
async function uploadBuffer(buffer, kind, mime) {
  const c = config();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: FOLDER, timestamp };
  const f = new FormData();
  f.set('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), 'upload');
  f.set('api_key', c.key); f.set('timestamp', String(timestamp)); f.set('folder', FOLDER); f.set('signature', sign(params, c.secret));
  let res, json;
  try {
    res = await fetch(`${apiBase()}/v1_1/${c.cloud}/${kind}/upload`, { method: 'POST', body: f, signal: AbortSignal.timeout(kind === 'video' ? 300000 : 60000) });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    console.error('Cloudinary unreachable:', e.message);
    throw new HttpError(502, 'The file could not be stored right now. Please try again.');
  }
  if (!res.ok || !json.public_id) {
    console.error('Cloudinary upload refused:', res.status, json && json.error && json.error.message);
    throw new HttpError(502, 'The file could not be stored right now. Please try again.');
  }
  return deliveryUrl(c.cloud, kind, json);
}

// For large files (the video) the browser uploads straight to Cloudinary, so Render never holds 100 MB in memory.
// The server signs the request; the browser cannot change the folder or anything else that is signed.
function signedUpload(kind) {
  const c = config();
  if (!c) throw new HttpError(409, 'Direct upload needs CLOUDINARY_URL.');
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    url: `${apiBase()}/v1_1/${c.cloud}/${kind}/upload`,
    fields: { api_key: c.key, timestamp: String(timestamp), folder: FOLDER, signature: sign({ folder: FOLDER, timestamp }, c.secret) }
  };
}

// After a direct upload the browser reports what Cloudinary answered. Only our own cloud and folder are accepted.
function urlFromUploadResult(kind, r) {
  const c = config();
  if (!c || !r) return null;
  const ok = typeof r.public_id === 'string' && new RegExp(`^${FOLDER}/[A-Za-z0-9_-]{1,100}$`).test(r.public_id)
    && /^\d{1,15}$/.test(String(r.version)) && /^[a-z0-9]{2,5}$/.test(String(r.format || 'mp4'));
  if (!ok || r.resource_type !== kind) return null;
  return deliveryUrl(c.cloud, kind, { public_id: r.public_id, version: r.version, format: r.format });
}

// Turns a delivery URL of ours back into what Cloudinary needs to delete it. Anything else gives null.
function parse(url) {
  const c = config();
  if (!c || typeof url !== 'string' || !url.startsWith(deliveryBase(c.cloud) + '/')) return null;
  const m = /^\/(image|video)\/upload\/(?:[^/]+\/)?v\d+\/(.+)\.[a-z0-9]+$/.exec(url.slice(deliveryBase(c.cloud).length));
  return m ? { kind: m[1], public_id: m[2] } : null;
}
const isOurs = url => !!parse(url);

// Best effort: a file that cannot be deleted only costs a little storage, it never breaks a page.
async function destroy(url) {
  const p = parse(url);
  if (!p) return;
  const c = config();
  const timestamp = Math.floor(Date.now() / 1000);
  const f = new URLSearchParams({ public_id: p.public_id, timestamp: String(timestamp), api_key: c.key, signature: sign({ public_id: p.public_id, timestamp }, c.secret) });
  try {
    const res = await fetch(`${apiBase()}/v1_1/${c.cloud}/${p.kind}/destroy`, { method: 'POST', body: f, signal: AbortSignal.timeout(15000) });
    if (!res.ok) console.error('Cloudinary delete refused:', res.status, p.public_id);
  } catch (e) { console.error('Cloudinary delete failed:', e.message); }
}

module.exports = { enabled, uploadBuffer, signedUpload, urlFromUploadResult, destroy, isOurs, parse, sign };
