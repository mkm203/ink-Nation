# Ink Nation tattoo studio: full-stack app

A website for a tattoo studio with a real back end.

- **Visitors** see the studio, the artists and recent work, read the FAQ, ask questions, and **book a session**.
  They get a reference code and can check or cancel their request later.
- **Prices and deposits:** each tattoo size has a price (or range) and a deposit. Visitors see them on the **Discover** page and in the booking form, and can **pay the deposit online** right after booking.
- **Shop:** the Discover page also sells products (cart, checkout). Customers pay in advance by **card / Apple Pay / Google Pay (Stripe)**, **Zelle**, **Chime** or **Bitcoin**. See `UPDATE.md` for how each one works and what it needs.
- **Emails:** customers are emailed when a booking is received, when a payment is reserved, and when it is paid (needs SMTP details in `.env`, see `UPDATE2.md`).
- **The studio** signs in at `/admin/` to manage bookings, orders and payments, prices, products, ways to pay, artists, work slides, FAQ, questions, contact details,
  and to **upload all the photos** (home page, work slides, artist portraits).
- **Stack:** Node.js, Express 5, MariaDB (XAMPP) with `mysql2`, plain HTML/CSS/JavaScript on the front end.

## 1. Set up (Windows, PowerShell)

You need Node.js 20 or newer (22 LTS is best) and XAMPP.

1. Open the XAMPP Control Panel and **start MySQL**.
2. Unzip this project, then in PowerShell:

```powershell
cd path\to\inkster-app
npm install
Copy-Item .env.example .env
notepad .env
```

3. In `.env` change at least `ADMIN_PASSWORD` and `JWT_SECRET`. Leave the database lines as they are if you use the XAMPP defaults (user `root`, empty password).
4. Create the database and the starter content (safe to run again):

```powershell
npm run db:init
```

5. Start the app:

```powershell
npm run dev
```

6. Open **http://localhost:3000** for the website and **http://localhost:3000/admin/** for the admin area.

## 2. Adding your photos

Sign in at `/admin/`, then:

| Where | What it changes |
|---|---|
| **Studio > Home page photo** | The large photo in the hero. A transparent **PNG** stands in front of the INK NATION lettering, as in the design. A **JPG** goes behind it. |
| **Work > Edit a slide > Photo** | A full-width photo replaces the drawn artwork on that slide. |
| **Artists > Edit > Photo** | A portrait replaces the drawn portrait. |
| **Bookings** | Reference images sent by clients open from the "Notes" column. |

Photos are JPG, PNG, WebP or GIF, up to 5 MB. They are stored in the `uploads/` folder. Without a photo, the site shows its drawn artwork, so it always looks finished.
You can also add, rename, reorder or hide artists, work slides and FAQ entries there.

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
config/db.js              the MariaDB connection pool
sql/schema.sql            the tables
scripts/init-db.js        creates the database and starter content  (npm run db:init)
scripts/api-test.js       65 automated checks                        (npm test)
src/lib/                  validation, money, image upload checks, error type, booking rules, payments (Stripe, Bitcoin), checkout
src/middleware/auth.js    admin sign-in (password from .env, httpOnly cookie)
src/models/               SQL for bookings, content, shop (tiers, products, payment methods) and orders
src/routes/public.js      what visitors can call (content, booking)
src/routes/shop.js        prices, products, orders, deposits, payment status
src/routes/webhooks.js    Stripe's payment confirmation (signature checked)
src/routes/admin.js       what the admin can call (needs sign-in)
public/                   the website (index.html, discover.html, css/, js/)
public/admin/             the admin area
uploads/                  photos uploaded through the app
```

### API

| Method and path | Who | What |
|---|---|---|
| `GET /api/studio`, `/api/artists`, `/api/works`, `/api/faq` | anyone | Content for the page |
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
| `/api/admin/bookings`, `/orders`, `/tiers`, `/products`, `/payments`, `/stats`, `/artists`, `/works`, `/faqs`, `/inquiries`, `/studio` | admin only | Manage everything (`401` without sign-in) |

## 5. Tests

```powershell
npm test
```

Runs 65 checks (validation, the 409 and 422 rules, uploads, sign-in, every admin operation, prices, stock, orders, Bitcoin amounts, simulated Stripe and its signed webhook, booking deposits).
It uses a **separate database** named `<DB_NAME>_test` and removes only the files it created, so your real data and photos are never touched.

## 6. Before you put it on the internet

- Set a long, private `ADMIN_PASSWORD` and `JWT_SECRET`. Never share `.env`.
- Serve it over **HTTPS** (a reverse proxy or a host that provides it) and run with `NODE_ENV=production`, which makes the admin cookie HTTPS-only. (On plain `http://localhost`, leave `NODE_ENV` unset.)
- **Notifications:** the app stores requests and shows them in the admin area. It does not send emails or SMS yet. Check the Bookings tab regularly, or add a mail service in `src/routes/public.js` after a booking is created.
- The contact details, artist names and texts are examples. Replace them in the admin area.
- Back up the `inkster_db` database and the `uploads/` folder.
- Money: Zelle, Chime and Bitcoin payments are confirmed **by you** in Admin > Orders & payments after you see the money in your own account. Card payments need a Stripe account (`UPDATE.md`).

## 7. Troubleshooting

| Message | Cause and fix |
|---|---|
| `Cannot reach the database` / `ECONNREFUSED` | MySQL is not running. Start it in XAMPP. |
| `Access denied for user` | Wrong `DB_USER` or `DB_PASSWORD` in `.env`. |
| `Unknown database` | Run `npm run db:init`. |
| `EADDRINUSE` | Port 3000 is taken. Change `PORT` in `.env`. |
| Admin says "disabled" | `ADMIN_PASSWORD` is empty in `.env`. |
| Changes to `.env` are ignored | Stop the server (Ctrl+C) and start it again. |
