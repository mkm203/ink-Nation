// Sends email in one of two ways:
//   1. Brevo's web API (BREVO_API_KEY + MAIL_FROM). Use this on Render's free plan: it blocks the SMTP ports (25, 465, 587), the web API is not blocked.
//   2. Any SMTP account (Gmail, your host...). Set SMTP_* in .env. Works on your own computer and on paid hosting.
// A failed or missing email never breaks a booking or payment: it is logged and the customer flow continues.
const nodemailer = require('nodemailer');

const env = k => (process.env[k] || '').trim();
const from = () => env('MAIL_FROM') || env('SMTP_USER');
const configured = () => (!!env('BREVO_API_KEY') || !!env('SMTP_HOST')) && !!from();
const outbox = []; // used by the automated tests (NODE_ENV=test) instead of really sending

let transport, warned = false;
function getTransport() {
  if (!transport) {
    const port = Number(env('SMTP_PORT')) || 587;
    transport = nodemailer.createTransport({
      host: env('SMTP_HOST'), port, secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465,
      auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass: process.env.SMTP_PASS || '' } : undefined
    });
  }
  return transport;
}

// "Ink Nation <hello@example.com>" -> { name, email }
function parseAddress(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || '');
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(s || '').trim() };
}

async function sendWithBrevo({ to, subject, text, html, replyTo }) {
  const body = { sender: parseAddress(from()), to: [{ email: to }], subject, textContent: text, htmlContent: html };
  if (replyTo) body.replyTo = parseAddress(replyTo);
  const r = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Brevo answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function send({ to, subject, text, html, replyTo }) {
  if (process.env.NODE_ENV === 'test') { outbox.push({ to, subject, text, html, replyTo }); return true; }
  if (!configured()) {
    if (!warned) { warned = true; console.warn('Emails are not set up yet (BREVO_API_KEY or SMTP_HOST, plus MAIL_FROM), so customers are not being emailed. See DEPLOY.md.'); }
    return false;
  }
  try {
    if (env('BREVO_API_KEY')) await sendWithBrevo({ to, subject, text, html, replyTo });
    else await getTransport().sendMail({ from: from(), to, subject, text, html, replyTo });
    return true;
  } catch (e) {
    console.error(`Email to ${to} failed: ${e.message}`);
    return false;
  }
}

// Runs in the background so the customer never waits for the mail server.
function later(fn) { Promise.resolve().then(fn).catch(e => console.error('Email error:', e.message)); }

module.exports = { send, later, configured, outbox, parseAddress };
