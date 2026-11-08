// Rules for a booking request, kept apart from the routes so they are easy to read and test.
const { parse } = require('./fields');

const NO_TIER = 'Not sure yet';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function today() { return ymd(new Date()); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }

// 'YYYY-MM-DD' that is a real calendar date? Returns the Date or null.
function realDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

const SPEC = {
  name: { type: 'str', required: true, min: 2, max: 100 },
  phone: { type: 'str', required: true, max: 30, pattern: /^\+?[0-9][0-9\s().-]{6,28}$/, message: 'Enter a valid phone number, for example +237 6 00 00 00 00.' },
  email: { type: 'str', required: true, max: 160, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address.' },
  tier_id: { type: 'int', min: 1 },
  piece: { type: 'str', max: 40 },
  date: { type: 'str', required: true },
  idea: { type: 'str', max: 2000 },
  artist_id: { type: 'int', min: 1 },
  bw: { type: 'bool' },
  colour: { type: 'bool' }
};

function validateBooking(body) {
  const { values, errors } = parse(SPEC, body);
  if (!errors.date && values.date) {
    const d = realDate(values.date);
    if (!d) errors.date = 'Choose a valid date.';
    else if (values.date < today()) errors.date = 'The date cannot be in the past.';
    else if (values.date > plusDays(365)) errors.date = 'Please choose a date within the next 12 months.';
    else if (d.getDay() === 0 || d.getDay() === 6) errors.date = 'The studio is open Monday to Friday. Please choose a weekday.';
  }
  const colour_mode = values.bw && values.colour ? 'both' : values.bw ? 'bw' : values.colour ? 'colour' : 'undecided';
  return {
    errors,
    clean: {
      name: values.name, phone: values.phone, email: (values.email || '').toLowerCase(), piece: values.piece || NO_TIER, tier_id: values.tier_id || null,
      preferred_date: values.date, idea: values.idea, artist_id: values.artist_id || null, colour_mode
    }
  };
}

module.exports = { NO_TIER, validateBooking, today, plusDays, realDate };
