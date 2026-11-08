// Money is always stored and calculated in whole cents. Only the screen shows dollars.
const usd = cents => {
  const n = Number(cents) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number(cents) % 100 ? 2 : 0, maximumFractionDigits: 2 });
};
module.exports = { usd };
