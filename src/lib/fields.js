// Tiny validator. A spec says what each field must look like; parse() returns clean values
// or a map of field -> message. Everything arrives as text (JSON or multipart), so we convert here.
const { HttpError } = require('./errors');

function parse(spec, body) {
  const values = {};
  const errors = {};
  body = body || {};
  for (const [key, def] of Object.entries(spec)) {
    let raw = body[key];
    if (typeof raw === 'string') raw = raw.trim();
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (def.required) errors[key] = 'This field is required.';
      else values[key] = def.default !== undefined ? def.default : null;
      continue;
    }
    switch (def.type) {
      case 'str':
        if (typeof raw !== 'string') { errors[key] = 'Must be text.'; break; }
        if (def.min && raw.length < def.min) { errors[key] = `Must be at least ${def.min} characters.`; break; }
        if (def.max && raw.length > def.max) { errors[key] = `Must be at most ${def.max} characters.`; break; }
        if (def.pattern && !def.pattern.test(raw)) { errors[key] = def.message || 'Invalid format.'; break; }
        values[key] = raw;
        break;
      case 'int': {
        const s = String(raw);
        const n = Number(s);
        if (!/^-?\d+$/.test(s) || !Number.isSafeInteger(n)) { errors[key] = 'Must be a whole number.'; break; }
        if (def.min !== undefined && n < def.min) { errors[key] = `Must be ${def.min} or more.`; break; }
        if (def.max !== undefined && n > def.max) { errors[key] = `Must be ${def.max} or less.`; break; }
        values[key] = n;
        break;
      }
      case 'money': {
        // Dollars typed by a person ("250", "$1,200", "49.90") become whole cents, so no rounding errors are ever stored.
        const m = /^\$?\s*(\d{1,7}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(String(raw).trim());
        if (!m) { errors[key] = 'Enter an amount in dollars, for example 250 or 49.90.'; break; }
        const cents = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
        if (!Number.isSafeInteger(cents)) { errors[key] = 'That amount is too large.'; break; }
        if (def.min !== undefined && cents < def.min) { errors[key] = `Must be at least $${(def.min / 100).toFixed(2).replace(/\.00$/, '')}.`; break; }
        if (def.max !== undefined && cents > def.max) { errors[key] = `Must be at most $${(def.max / 100).toFixed(2).replace(/\.00$/, '')}.`; break; }
        values[key] = cents;
        break;
      }
      case 'bool':
        values[key] = raw === true || raw === 'true' || raw === '1' || raw === 1 ? 1 : 0;
        break;
      case 'enum':
        if (!def.values.includes(raw)) { errors[key] = `Must be one of: ${def.values.join(', ')}.`; break; }
        values[key] = raw;
        break;
    }
  }
  return { values, errors, ok: Object.keys(errors).length === 0 };
}

// Throws a 422 when parse() found problems.
function parseOrThrow(spec, body) {
  const r = parse(spec, body);
  if (!r.ok) throw new HttpError(422, 'Please check the highlighted fields.', r.errors);
  return r.values;
}

function intParam(value, name = 'id') {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive whole number.`);
  return n;
}

module.exports = { parse, parseOrThrow, intParam };
