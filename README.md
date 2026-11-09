# Ink Nation tattoo studio: full-stack app

A website for a tattoo studio with a real back end.

- **Visitors** see the studio, the artists, recent work, prices and customer reviews, read the FAQ, ask questions, and **book a session**.
  They get a reference code and can check or cancel their request later.
- **Prices and deposits:** each tattoo size has a price (or range), a deposit and an optional photo. Visitors see them on the **Discover** page and in the booking form, and can **pay the deposit online** right after booking.
- **Payments:** card / Apple Pay / Google Pay (Stripe), **Zelle**, **Chime** or **Bitcoin**. The public shop/cart was removed; the shop API and order tables are still available.
- **Emails:** customers and the studio are emailed when a booking is received, when a payment is reserved, and when it is paid (needs SMTP details in `.env`, or `BREVO_API_KEY` on Render's free plan; see `DEPLOY.md`).
- **The studio** signs in at `/admin/` to manage bookings, orders and payments, prices, ways to pay, artists, artist photos, recent work, reviews, FAQ, questions, contact details,
  and to **upload all the photos** (home page, work slides, artist portraits, galleries, price tiers, reviewer photos).
- **Stack:** Node.js 22.5+, Express 5, **SQLite** (`node:sqlite`, one file, no database server), plain HTML/CSS/JavaScript on the front end.

## 1. Set up (Windows, PowerShell)

You need Node.js 22.5 or newer (22 LTS or 24 LTS). No XAMPP/MySQL needed.

1. Unzip this project, then in PowerShell:

```powershell
cd path\to\inkster-app
npm install
Copy-Item .env.example .env
notepad .env
```

2. In `.env` set at least `ADMIN_PASSWORD` and `JWT_SECRET`. The database lines are now
   `DB_FILE` and `UPLOAD_DIR`; the defaults (`data/inkster.db` and `uploads/`) are fine.
3. Create the database and the starter content (safe to run again):

```powershell
npm run db:init
```

4. Start the app:

```powershell
npm run dev
```

5. Open **http://localhost:3000** for the website and **http://localhost:3000/admin/** for the admin area.

To put it online for free (Render + a free Turso database, email, Stripe webhook), follow **[DEPLOY.md](DEPLOY.md)**.

## 2. Adding your photos

Sign in at `/admin/`, then:

| Where | What it changes |
|---|---|
| **Studio > Home page photo** | The large photo in the hero. A transparent **PNG** stands in front of the INK NATION lettering, as in the design. A **JPG** goes behind it. |
| **Recent work > Edit a slide > Photo** | A full-width photo replaces the drawn artwork on that slide. Only studio pieces belong here. |
| **Artists > Edit > Photo** | A portrait replaces the drawn portrait. |
| **Artist photos** | Each artist's personal gallery in the **Our team** section. Add at least 3 photos per artist. These never appear in Recent work. |
| **Pricing > Edit a size > Photo** | A photo for that tattoo size, shown on the Discover page. |
| **Reviews > Edit > Reviewer's photo** | The customer photo shown next to their review. |
| **Bookings** | Reference images sent by clients open from the "Notes" column. |

Photos are JPG, PNG, WebP or GIF, up to 5 MB (the studio video can be MP4/WebM up to 30 MB). They are stored in `uploads/` (or `UPLOAD_DIR`). Without a photo, the site shows its drawn artwork, so it always looks finished.
You can also add, rename, reorder or hide artists, gallery photos, work slides, tiers, reviews and FAQ entries there.

## 3. What the booking form checks

- Name, phone number, email and date are required and validated on the server.
- The date must be a **weekday** in the next 12 months (the studio is open Monday to Friday).
- **Capacity:** one artist takes at most `SLOTS_PER_ARTIST_PER_DAY` sessions per day (2 by default, set in `.env`). A full day answers **409**. Checked inside a database transaction, so two people booking at the same moment cannot take the last slot together.
- The same person cannot send the same artist and date twice (**409**).
- A visitor can look up or cancel a request only with the **reference code and the email** used.
- Admin changes to a status are also checked: a cancelled booking cannot be reopened onto a day that is full.

## 4. How it is organised

```
server.js                 starts Express, serves /api, /uploads and the website
config/db.js              the SQLite database (one file, no server)
sql/schema.sql            the tables
scripts/init-db.js        creates the database and starter content  (npm run db:init)
scripts/import-mysql.js   copies old MySQL content into SQLite     (npm run db:import)
scripts/api-test.js       68 automated checks                      (npm test)
src/lib/                  validation, money, image/video upload checks, error type, booking rules, emails, payments (Stripe, Bitcoin), checkout
src/middleware/auth.js    admin sign-in (password from .env, httpOnly cookie)
src/models/               SQL for bookings, content, shop (tiers, products, payment methods) and orders
src/routes/public.js      what visitors can call (content, reviews, booking)
src/routes/shop.js        prices, products, orders, deposits, payment status
src/routes/webhooks.js    Stripe's payment confirmation (signature checked)
src/routes/admin.js       what the admin can call (needs sign-in)
public/                   the website (index.html, discover.html, css/, js/)
public/admin/             the admin area
uploads/                  photos and video uploaded through the app (or UPLOAD_DIR)
data/                     the SQLite database file (or DB_FILE)
```

### API

| Method and path | Who | What |
|---|---|---|
| `GET /api/studio`, `/api/artists`, `/api/works`, `/api/faq`, `/api/reviews` | anyone | Content for the page (artists include their gallery) |
| `GET /api/availability?artistId=1` | anyone | Dates on which that artist is full |
| `POST /api/bookings` | anyone | Send a booking (`multipart/form-data`, optional `reference_image`). `201`, `409`, `422` |
| `GET /api/bookings/:ref?email=` | the client | Check a request |
| `POST /api/bookings/:ref/cancel` | the client | Cancel a request |
| `POST /api/inquiries` | anyone | Ask the studio a question |
| `GET /api/tiers`, `/api/products`, `/api/payment-methods` | anyone | Prices, shop products, ways to pay that are switched on |
| `POST /api/orders` | anyone | Place a shop order and get payment instructions |
| `POST /api/bookings/:ref/deposit` | the client | Start paying a booking deposit |
| `GET /api/orders/:ref?email=` | the client | Order status (also re-checks a card payment with Stripe) |
| `POST /api/orders/:ref/submitted`, `/cancel` | the client | "I sent the payment" / cancel an unpaid order |
| `POST /api/webhooks/stripe` | Stripe | Confirms card payments (signed) |
| `POST /api/admin/login`, `/logout` | admin | Sign in and out |
| `/api/admin/bookings`, `/orders`, `/tiers`, `/products`, `/payments`, `/stats`, `/artists`, `/artist_photos`, `/works`, `/reviews`, `/faqs`, `/inquiries`, `/studio` | admin only | Manage everything (`401` without sign-in) |

## 5. Tests

```powershell
npm test
```

Runs 68 checks (validation, the 409 and 422 rules, uploads, sign-in, every admin operation, artist galleries, reviews with photos, prices, stock, orders, Bitcoin amounts, simulated Stripe and its signed webhook, booking deposits, customer and studio emails).
It uses a **separate SQLite file** (`data/inkster-test.db`), deletes it before each run, and removes only the files it created, so your real data and photos are never touched.

## 6. Before you put it on the internet

- Set a long, private `ADMIN_PASSWORD` and `JWT_SECRET`. Never share `.env`.
- Serve it over **HTTPS** (a host such as Render provides it) and run with `NODE_ENV=production`, which makes the admin cookie HTTPS-only. (On plain `http://localhost`, leave `NODE_ENV` unset.)
- **Notifications:** booking requests, payment reservations and received payments are emailed to the customer and to `ADMIN_EMAIL` (or the studio email). Without SMTP settings the app logs one warning and continues; everything is still in the admin area.
- The contact details, artist names and texts are examples. Replace them in the admin area.
- Back up the SQLite file (`DB_FILE`) and the `UPLOAD_DIR` folder. On the free Render setup the data lives in Turso instead (see DEPLOY.md); photos are stored inside it.
- Money: Zelle, Chime and Bitcoin payments are confirmed **by you** in Admin > Orders & payments after you see the money in your own account. Card payments need a Stripe account (`UPDATE.md`) and a webhook pointing at `/api/webhooks/stripe`.
- Step-by-step hosting instructions: **[DEPLOY.md](DEPLOY.md)**.

## 7. Troubleshooting

| Message | Cause and fix |
|---|---|
| `Cannot find module 'node:sqlite'` | Node is older than 22.5. Install Node 22 LTS or newer. |
| `Database setup failed` | Check that `DB_FILE` and `UPLOAD_DIR` point at a folder the app can write to. |
| `EADDRINUSE` | Port 3000 is taken. Change `PORT` in `.env`. |
| Admin says "disabled" (503) | `ADMIN_PASSWORD` is empty in `.env`. |
| Signed out after every restart | `JWT_SECRET` is missing, so a random one is used each time. |
| Changes to `.env` are ignored | Stop the server (Ctrl+C) and start it again. |
