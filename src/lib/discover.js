// Discover products, deposits and the payment details the studio publishes.
const PAYMENT_METHODS = ['applepay', 'zelle', 'chime', 'bitcoin'];

const PRODUCT_SPEC = {
  slug: { type: 'str', required: true, max: 80, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, message: 'Lower-case letters, digits and single hyphens only.' },
  name: { type: 'str', required: true, max: 120 },
  category: { type: 'str', required: true, max: 60, default: 'Tattoo' },
  description: { type: 'str', required: true, max: 1500 },
  price_min: { type: 'int', min: 0, max: 1000000, default: 0 },
  price_max: { type: 'int', min: 0, max: 1000000, default: 0 },
  deposit: { type: 'int', required: true, min: 0, max: 1000000 },
  art_key: { type: 'enum', values: ['irezumi', 'rose', 'mandala'], default: 'mandala' },
  payment_link: { type: 'str', max: 500, pattern: /^https?:\/\/\S+$/, message: 'Use a full http:// or https:// link.' },
  sort_order: { type: 'int', min: 0, max: 9999, default: 0 },
  active: { type: 'bool', default: 1 }
};

const PAYMENT_SPEC = {
  discover_title: { type: 'str', max: 120 },
  discover_intro: { type: 'str', max: 1000 },
  deposit_instructions: { type: 'str', max: 1000 },
  pay_applepay_url: { type: 'str', max: 500, pattern: /^https?:\/\/\S+$/, message: 'Use a full http:// or https:// link.' },
  pay_zelle_name: { type: 'str', max: 120 },
  pay_zelle_contact: { type: 'str', max: 200 },
  pay_chime_name: { type: 'str', max: 120 },
  pay_chime_contact: { type: 'str', max: 200 },
  pay_bitcoin_address: { type: 'str', max: 200 }
};

const DEPOSIT_SPEC = {
  product_id: { type: 'int', required: true, min: 1 },
  name: { type: 'str', required: true, min: 2, max: 100 },
  phone: { type: 'str', required: true, max: 30, pattern: /^\+?[0-9][0-9\s().-]{6,28}$/, message: 'Enter a valid phone number, for example +237 6 00 00 00 00.' },
  email: { type: 'str', required: true, max: 160, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address.' },
  notes: { type: 'str', max: 2000 },
  payment_method: { type: 'enum', required: true, values: PAYMENT_METHODS }
};

// Settings are key/value rows. Pick only the keys the Discover page and admin form use.
function paymentConfig(settings) {
  return {
    applepay_url: settings.pay_applepay_url || '',
    zelle: { name: settings.pay_zelle_name || '', contact: settings.pay_zelle_contact || '' },
    chime: { name: settings.pay_chime_name || '', contact: settings.pay_chime_contact || '' },
    bitcoin: { address: settings.pay_bitcoin_address || '' },
    instructions: settings.deposit_instructions || ''
  };
}

// Apple Pay / card needs a hosted payment link; the other methods are manual instructions.
function availableMethods(product, cfg) {
  const methods = [];
  if (product.payment_link || cfg.applepay_url) methods.push('applepay');
  if (cfg.zelle.contact) methods.push('zelle');
  if (cfg.chime.contact) methods.push('chime');
  if (cfg.bitcoin.address) methods.push('bitcoin');
  return methods;
}

function methodDetails(method, product, cfg) {
  if (method === 'applepay') {
    const url = product.payment_link || cfg.applepay_url;
    return { method, type: 'link', label: 'Card / Apple Pay', url };
  }
  if (method === 'zelle') return { method, type: 'manual', label: 'Zelle', recipient: cfg.zelle.name, contact: cfg.zelle.contact };
  if (method === 'chime') return { method, type: 'manual', label: 'Chime', recipient: cfg.chime.name, contact: cfg.chime.contact };
  return { method, type: 'bitcoin', label: 'Bitcoin', address: cfg.bitcoin.address, uri: 'bitcoin:' + cfg.bitcoin.address };
}

const publicProduct = p => ({
  id: p.id, slug: p.slug, name: p.name, category: p.category, description: p.description,
  price_min: p.price_min, price_max: p.price_max, deposit: p.deposit, currency: p.currency,
  image: p.image, art_key: p.art_key, payment_link: p.payment_link, sort_order: p.sort_order
});

// A visitor only sees their own deposit's non-sensitive fields (reference + email are required).
const publicDeposit = d => ({
  reference: d.reference, product_id: d.product_id, product_name: d.product_name,
  amount: d.amount, deposit: d.amount, currency: d.currency,
  payment_method: d.payment_method, status: d.status, created_at: d.created_at
});

module.exports = {
  PAYMENT_METHODS, PRODUCT_SPEC, PAYMENT_SPEC, DEPOSIT_SPEC,
  paymentConfig, availableMethods, methodDetails, publicProduct, publicDeposit
};
