// Reference codes avoid look-alike characters (0/O, 1/I/L) so they are easy to read out loud.
const crypto = require('crypto');

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newReference(prefix = 'INK-') {
  const b = crypto.randomBytes(6);
  let s = prefix;
  for (let i = 0; i < 6; i++) s += CHARS[b[i] % CHARS.length];
  return s;
}

module.exports = { newReference };
