-- Ink Nation schema for SQLite. Safe to run more than once.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT NOT NULL,
  specialty TEXT NOT NULL,
  experience_years INTEGER NOT NULL DEFAULT 0,
  photo TEXT NULL,
  art_key TEXT NOT NULL DEFAULT 'waves',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Recent work shown on the home page. Items with no artist are studio pieces.
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist_id INTEGER NULL,
  description TEXT NOT NULL,
  image TEXT NULL,
  art_key TEXT NOT NULL DEFAULT 'irezumi',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

-- Personal galleries for the "Our team" section. These never appear in Recent work.
CREATE TABLE IF NOT EXISTS artist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL,
  image TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Customer reviews shown on the home page. The studio adds and edits them in the admin area.
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image TEXT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  review TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  artist_id INTEGER NULL,
  piece TEXT NOT NULL,
  colour_mode TEXT NOT NULL DEFAULT 'undecided',
  preferred_date TEXT NOT NULL,
  idea TEXT NULL,
  reference_image TEXT NULL,
  tier_id INTEGER NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  question TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tattoo sizes with their price range and the deposit that secures a booking. Edited in the admin area.
CREATE TABLE IF NOT EXISTS price_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  price_max_cents INTEGER NULL,
  deposit_cents INTEGER NOT NULL,
  image TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock INTEGER NULL,
  image TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- One row per way of paying. Zelle, Chime and Bitcoin are paid by the customer straight to the studio's own account.
CREATE TABLE IF NOT EXISTS payment_methods (
  method TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  account TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Shop purchases and booking deposits both live here, so payments are handled in one place.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'shop',
  booking_id INTEGER NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  payment_note TEXT NOT NULL DEFAULT '',
  stripe_session_id TEXT NULL,
  pay_url TEXT NULL,
  pay_to TEXT NOT NULL DEFAULT '',
  btc_sats INTEGER NULL,
  btc_rate NUMERIC NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NULL,
  name TEXT NOT NULL,
  unit_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings (artist_id, preferred_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_artist_photos ON artist_photos (artist_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_booking ON orders (booking_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
