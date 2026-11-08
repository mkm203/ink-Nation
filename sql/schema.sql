-- Ink Nation schema. Safe to run more than once.
CREATE TABLE IF NOT EXISTS artists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  bio TEXT NOT NULL,
  specialty VARCHAR(160) NOT NULL,
  experience_years INT NOT NULL DEFAULT 0,
  photo VARCHAR(255) NULL,
  art_key VARCHAR(20) NOT NULL DEFAULT 'waves',
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  artist_id INT NULL,
  description TEXT NOT NULL,
  image VARCHAR(255) NULL,
  art_key VARCHAR(20) NOT NULL DEFAULT 'irezumi',
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_work_artist FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS faqs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question VARCHAR(255) NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

-- Customer reviews shown on the home page. The studio adds and edits them in the admin area.
CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rating TINYINT NOT NULL DEFAULT 5,
  review TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(40) PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(12) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(160) NOT NULL,
  artist_id INT NULL,
  piece VARCHAR(40) NOT NULL,
  colour_mode ENUM('bw','colour','both','undecided') NOT NULL DEFAULT 'undecided',
  preferred_date DATE NOT NULL,
  idea TEXT NULL,
  reference_image VARCHAR(255) NULL,
  tier_id INT NULL,
  deposit_cents INT NOT NULL DEFAULT 0,
  deposit_paid TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_day (artist_id, preferred_date, status),
  INDEX idx_status (status),
  CONSTRAINT fk_booking_artist FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(160) NOT NULL,
  question TEXT NOT NULL,
  handled TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tattoo sizes with their price range and the deposit that secures a booking. Edited in the admin area.
CREATE TABLE IF NOT EXISTS price_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  price_cents INT NOT NULL,
  price_max_cents INT NULL,
  deposit_cents INT NOT NULL,
  image VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'General',
  description VARCHAR(1000) NOT NULL DEFAULT '',
  price_cents INT NOT NULL,
  stock INT NULL,
  image VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

-- One row per way of paying. Zelle, Chime and Bitcoin are paid by the customer straight to the studio's own account.
CREATE TABLE IF NOT EXISTS payment_methods (
  method VARCHAR(12) PRIMARY KEY,
  label VARCHAR(60) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  account VARCHAR(200) NOT NULL DEFAULT '',
  instructions VARCHAR(600) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0
);

-- Shop purchases and booking deposits both live here, so payments are handled in one place.
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(12) NOT NULL UNIQUE,
  kind ENUM('shop','deposit') NOT NULL DEFAULT 'shop',
  booking_id INT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NOT NULL DEFAULT '',
  note VARCHAR(500) NOT NULL DEFAULT '',
  total_cents INT NOT NULL,
  method ENUM('card','zelle','chime','bitcoin') NOT NULL,
  status ENUM('awaiting_payment','payment_submitted','paid','fulfilled','cancelled') NOT NULL DEFAULT 'awaiting_payment',
  payment_note VARCHAR(200) NOT NULL DEFAULT '',
  stripe_session_id VARCHAR(120) NULL,
  pay_url TEXT NULL,
  pay_to VARCHAR(200) NOT NULL DEFAULT '',
  btc_sats BIGINT NULL,
  btc_rate DECIMAL(14,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  INDEX idx_order_status (status),
  INDEX idx_order_booking (booking_id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  name VARCHAR(160) NOT NULL,
  unit_cents INT NOT NULL,
  qty INT NOT NULL,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
