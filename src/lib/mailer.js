// Sends email through any SMTP account (Gmail, your host, Brevo...). Set SMTP_* in .env.
// A failed or missing email never breaks a booking or payment: it is logged and the customer flow continues.
const nodemailer = require('nodemailer');

const env = k => (process.env[k] || '').trim();
const from = () => env('MAIL_FROM') || env('SMTP_USER');
const configured = () => !!env('SMTP_HOST') && !!from();
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

async function send({ to, subject, text, html, replyTo }) {
  if (process.env.NODE_ENV === 'test') { outbox.push({ to, subject, text, html, replyTo }); return true; }
  if (!configured()) {
    if (!warned) { warned = true; console.warn('Emails are not set up yet (SMTP_HOST and MAIL_FROM in .env), so customers are not being emailed. See UPDATE2.md.'); }
    return false;
  }
  try {
    await getTransport().sendMail({ from: from(), to, subject, text, html, replyTo });
    return true;
  } catch (e) {
    console.error(`Email to ${to} failed: ${e.message}`);
    return false;
  }
}

// Runs in the background so the customer never waits for the mail server.
function later(fn) { Promise.resolve().then(fn).catch(e => console.error('Email error:', e.message)); }

module.exports = { send, later, configured, outbox };
