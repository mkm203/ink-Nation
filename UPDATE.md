# Update: Ink Nation + Discover page + prices + online payments

This update goes **on top of the folder you already have** (`inkster-app`). Your database content and uploaded photos are kept.

## What you get

- The site is renamed **Ink Nation** (hero, logo, menu, footer lettering, texts).
- A new **Discover** page (`/discover.html`): tattoo prices with deposits, a shop with cart, ways to pay, and an order lookup.
- Your five prices and deposits are already entered. You edit them in **Admin > Pricing** (typed in dollars).
- The booking form now has a **Size** list with prices. After booking, the visitor can **pay the deposit** at once, or later from "Check its status".
- Pay in advance with: **card / Apple Pay / Google Pay** (through Stripe), **Zelle**, **Chime**, **Bitcoin**.
- New admin tabs: **Orders & payments**, **Pricing**, **Shop products**, **Ways to pay**.

## Step 1. Stop the app and (recommended) back up

1. In the PowerShell window where the app runs, press `Ctrl+C`.
2. Open XAMPP and make sure **MySQL is running**.
3. Optional but wise: open http://localhost/phpmyadmin, click your database (`inkster_db`), then **Export > Go**. Keep the file.

## Step 2. Copy the files

Unzip `ink-nation-update.zip`. Inside is a folder `inkster-app` that has the **same structure as yours**. Copy its contents into your `inkster-app` folder and choose **Replace the files in the destination** when Windows asks. Do **not** delete anything of yours. Your `.env`, `uploads` and `node_modules` are not in the zip, so they are untouched.

| File in the zip | Goes to (inside your `inkster-app` folder) | New or replaces |
|---|---|---|
| `server.js` | `inkster-app\server.js` | replaces |
| `package.json` | `inkster-app\package.json` | replaces |
| `.env.example`, `README.md`, `UPDATE.md` | `inkster-app\` | replaces / new |
| `sql\schema.sql` | `inkster-app\sql\` | replaces |
| `scripts\init-db.js`, `scripts\api-test.js` | `inkster-app\scripts\` | replaces |
| `src\lib\fields.js`, `src\lib\bookingRules.js` | `inkster-app\src\lib\` | replaces |
| `src\lib\money.js`, `src\lib\payments.js`, `src\lib\checkout.js` | `inkster-app\src\lib\` | **new** |
| `src\models\bookings.js` | `inkster-app\src\models\` | replaces |
| `src\models\orders.js`, `src\models\shop.js` | `inkster-app\src\models\` | **new** |
| `src\routes\public.js`, `src\routes\admin.js` | `inkster-app\src\routes\` | replaces |
| `src\routes\shop.js`, `src\routes\webhooks.js` | `inkster-app\src\routes\` | **new** |
| `public\index.html` | `inkster-app\public\` | replaces |
| `public\discover.html` | `inkster-app\public\` | **new** |
| `public\css\site.css` | `inkster-app\public\css\` | replaces |
| `public\css\shop.css` | `inkster-app\public\css\` | **new** |
| `public\js\app.js` | `inkster-app\public\js\` | replaces |
| `public\js\common.js`, `pay.js`, `discover.js` | `inkster-app\public\js\` | **new** |
| `public\admin\admin.js`, `admin.css`, `index.html` | `inkster-app\public\admin\` | replaces |

Not in the zip and not touched: `.env`, `uploads\`, `node_modules\`, `config\db.js`, `src\lib\images.js`, `src\lib\errors.js`, `src\middleware\auth.js`, `src\models\content.js`, `public\js\art.js`.

## Step 3. Install, update the database, start

```powershell
cd path\to\inkster-app
npm install
npm run db:init
npm run dev
```

- `npm install` adds one small package (`qrcode`, for the Bitcoin QR code).
- `npm run db:init` is safe on your existing data. It adds the new tables and columns, adds your five prices, adds four **example** products, and renames the studio to "Ink Nation" **only where the old default text was still there** (anything you changed yourself stays). You should see lines like `Added column bookings.tier_id` and `Added your 5 pricing tiers`.
- Optional: `npm test` runs 57 checks on a separate test database.

Open http://localhost:3000 and http://localhost:3000/discover.html.

## Step 4. Set up in the admin (http://localhost:3000/admin/)

1. **Pricing**: your five prices and deposits are there. Click Edit to change them, add a size, hide one, or reorder. Small tattoo has a range ($250 to $350), so its "highest price" box is filled; leave that box empty for a single price.
2. **Ways to pay**: for each of Zelle, Chime and Bitcoin, type **your own** account (Zelle email or phone, Chime ChimeSign, Bitcoin address) and tick **Offer this to customers**. Nothing shows on the site until you do this. Card needs Stripe first (below).
3. **Shop products**: the four products are examples. Edit or delete them, add your own with a photo, a price and a stock number (leave stock empty for unlimited).
4. **Studio**: new boxes for the Discover page intro and the note under the prices. Also update your real phone, email and address.

Day to day, open **Orders & payments**. Orders waiting for your check are listed first. Look at your Zelle, Chime or wallet, then set the order to **Paid**. A paid deposit shows as "PAID" on the booking. Cancelling an order puts its items back in stock. Unpaid orders are cancelled automatically after 24 hours.

## How each payment method really works

| Method | What the customer sees | Who confirms | What you need |
|---|---|---|---|
| **Zelle** | Your Zelle email or phone, the exact amount, an order code to write in the note | **You**, by hand, after the money arrives | A US bank account with Zelle |
| **Chime** | Your ChimeSign, the exact amount, the order code | **You**, by hand | A US Chime account |
| **Bitcoin** | Exact BTC amount at the live rate, your address, a QR code | **You**, by hand, after you see it in your wallet | Your own wallet address. The app never holds keys or money |
| **Card, Apple Pay, Google Pay** | Redirect to a secure Stripe page | **Automatic** | A Stripe account (see below) |

Important and honest:

- **Zelle and Chime have no way for a website to confirm payment.** The customer presses "I have sent the payment" and you verify it yourself. That is how every small shop does it.
- **Bitcoin:** the amount is fixed when the customer orders, using a live price (Coinbase, then CoinGecko as backup). It is rounded up to the next satoshi. If the price service is unreachable, Bitcoin is refused for that order instead of guessing.
- **Apple Pay cannot be added by itself.** It only exists through a payment provider. Here that provider is Stripe: once Stripe is set up, Apple Pay and Google Pay appear automatically on the Stripe page for customers on supported devices. Apple Pay also needs the site on **HTTPS with a real domain** that you register in the Stripe dashboard (Settings > Payment methods > Apple Pay). It will not appear on `localhost`.
- **Stripe is only available to businesses in countries it supports.** I do not believe Cameroon is on that list, so check https://stripe.com/global before relying on it. If Stripe is not possible for you, leave Card switched off: Zelle, Chime and Bitcoin work without it. If the studio is registered in a supported country (for example the US, given the dollar prices and Zelle/Chime), Stripe works.

## Optional: card payments with Stripe

1. Create a Stripe account and get the **secret key** (Developers > API keys). Use the **test** key (`sk_test_...`) first.
2. Add to your `.env` file (open it with `notepad .env`):

```
APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=
```

3. Restart the app (`Ctrl+C`, then `npm run dev`). In **Admin > Ways to pay > Card**, it now says "Stripe key found". Tick **Offer this to customers** and Save.
4. Test with Stripe's test card `4242 4242 4242 4242`, any future date, any CVC. After paying, the customer returns to the Discover page and the order turns **Paid** by itself (the app asks Stripe when the customer comes back).
5. **When the site is online**, add a webhook in Stripe (Developers > Webhooks): URL `https://your-domain/api/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`. Copy its signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`, set `APP_URL` to your real address, switch to the live key, restart. The webhook makes payments confirm even if the customer closes the page. Every webhook is checked against its signature, and the paid amount must match the order.

## What was tested, and what was not

Tested (all passing): prices and deposits, money handling, stock (including 6 buyers racing for 3 items), orders and cancellation, order expiry, booking deposits, Bitcoin amounts and QR, the whole admin, and the website in a real browser on desktop and phone width.

**Not tested:** a real Stripe account (the card flow and webhook were tested against a simulated Stripe that behaves like the documented API), Apple Pay itself (needs your domain and a real device), and real Zelle, Chime or Bitcoin transfers. Do one small real test of each method yourself before announcing it.

## If something goes wrong

| Message | Fix |
|---|---|
| `Cannot find module 'qrcode'` | You skipped `npm install`. Run it. |
| `Unknown column 'tier_id'` or `Table ... doesn't exist` | Run `npm run db:init`. |
| Discover page shows no prices | Run `npm run db:init`, then restart the app. |
| "Card payments need a Stripe key" in the admin | Add `STRIPE_SECRET_KEY` to `.env` and restart. |
| A method is not shown on the site | It is switched off, or has no account typed, in Ways to pay. |
| Bitcoin says prices cannot be loaded | The server could not reach the internet price service. Try again, or use another method. |
| Old page still shows after copying | Press `Ctrl+F5` in the browser. |
