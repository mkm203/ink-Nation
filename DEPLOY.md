# Deploying Ink Nation

The app is a normal Node.js server: Express serves the API **and** the website. There is no build step.

**Use a host that runs Node, such as Render.** Netlify can host static files only, so it cannot run this app
(see [Netlify](#netlify) below).

Where the data lives depends on your budget:

| | Cost | Where the data lives |
|---|---|---|
| **A. Render free + Turso** (this guide, below) | **$0** | A free hosted SQLite database on Turso. Photos and video are stored in it too. |
| B. Render paid + persistent disk | about $7/month | A file on Render's disk (see [Paid disk option](#b-paid-disk-option)). |

Why A needs Turso: Render's **free** plan erases its own files on every deploy, restart and after
15 minutes of no visitors. A database *file* on a free Render service therefore disappears. Turso keeps
the data somewhere else, so the website can restart as often as it likes.

---

## A. Render free + Turso (free)

Do the steps in order. Steps 1 to 3 are required, 4 and 5 are optional.

### 1. Create the free Turso database

1. Go to <https://turso.tech> and sign up (GitHub or Google works; no credit card needed).
2. Create a database. Name it `ink-nation`. For the location choose the one **closest to your Render
   service** (Render dashboard → your service shows its region; Oregon ↔ `us-west`, Virginia/Ohio ↔
   `us-east`, Frankfurt ↔ `eu`). Pages are faster when both are close.
3. Open the database and find two things (Turso's screens change from time to time, so the button
   names may differ a little):
   - **The database URL.** It starts with `libsql://`, for example `libsql://ink-nation-yourname.turso.io`.
   - **An auth token.** Create one with *read and write* access. It is a long text; copy it right away.

Keep these two values private. Anyone who has the token can change your data.

### 2. Copy your real content to Turso (once)

This sends the `data/inkster.db` file and the `uploads/` folder from your computer to Turso. Do it **before**
you point Render at Turso, so the live site starts with your real content.

1. **Stop** your local server (close the `npm run dev` window).
2. Open PowerShell in the project folder and run these, one line at a time. Use your own values
   from step 1:

```powershell
cd C:\Users\MKM\Desktop\inkster-app\inkster-app
npm install
$env:TURSO_DATABASE_URL = "libsql://ink-nation-yourname.turso.io"
$env:TURSO_AUTH_TOKEN   = "paste-your-long-token-here"
node scripts/push-to-turso.js
```

3. It shows what is on your computer and what is in Turso now, then asks you to type `YES`.
   **It replaces everything in Turso with your local copy.** If you run it again later, anything added on the
   live site in the meantime is overwritten.
4. When it says `Done`, clear the token from that window:

```powershell
Remove-Item Env:TURSO_DATABASE_URL, Env:TURSO_AUTH_TOKEN
```

5. Nothing is visible yet: the live site only uses Turso after step 3.

> **Do not put the Turso values in your local `.env` file.** If you do, running the app on your computer
> would edit the live data. Setting them in PowerShell as above only lasts for that window.

The script lists any picture your data mentions that was not in the `uploads/` folder. Those show as
broken until you upload them again in the admin area.

### 3. Tell Render about it, and deploy

Render dashboard → your service → **Environment** → add:

| Key | Value |
|---|---|
| `TURSO_DATABASE_URL` | the `libsql://…` address from step 1 |
| `TURSO_AUTH_TOKEN` | the token from step 1 |

Keep what you already have: `ADMIN_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL`, `NODE_ENV=production`,
`APP_URL=https://YOUR-APP.onrender.com`. You can **delete** `DB_FILE` and `UPLOAD_DIR` if you added them;
they are not used any more.

Under **Settings**: Build Command `npm install`, Start Command `npm start`.

Push the new code to GitHub (`git add .`, `git commit -m "free hosting"`, `git push`) and Render deploys it. The log must say:

```
Database: Turso database ink-nation-yourname.turso.io
Uploads: kept in the database
```

If it says `Database: /opt/render/...` the two Turso values did not save on this service.

Open `https://YOUR-APP.onrender.com`. The first visit after a quiet period takes about a minute (the free
server is waking up). Your artists, prices, bookings and photos should all be there. Restart the service from
the Render dashboard and check again: the content stays.

### 4. Emails on the free plan (Brevo)

Render's free plan **blocks the ports used by SMTP (25, 465 and 587)**, so Gmail SMTP cannot send from
there. Brevo offers a free email service that works over the normal web port instead:

1. Sign up at <https://www.brevo.com> (free plan: 300 emails a day).
2. Add and verify a **sender** (the address your emails come from; Brevo emails you a confirmation link).
3. Create an **API key** (in Brevo: SMTP & API → API keys).
4. On Render → Environment add:

| Key | Value |
|---|---|
| `BREVO_API_KEY` | the API key |
| `MAIL_FROM` | `Ink Nation <your-verified-sender@example.com>` |

When `BREVO_API_KEY` is set it is used instead of the `SMTP_*` values. Emails go to the customer
(booking received, payment reserved, payment received) and to `ADMIN_EMAIL`.
A sender on a free address such as `@gmail.com` can land in spam; an address on your own domain is better.
If emails fail, the website still works and the log shows `Email to … failed`.

### 5. Stripe webhook (only for card payments)

In the Stripe dashboard → **Developers** → **Webhooks** → **Add endpoint**:

- URL: `https://YOUR-APP.onrender.com/api/webhooks/stripe`
- Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`

Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Render.

### Good to know about the free plans

- **Slow first visit.** Render's free server sleeps after 15 minutes without visitors and takes about a
  minute to wake. Your data is not affected. A free uptime monitor that opens `/api/health` every few
  minutes keeps it awake (Render gives 750 free hours a month, enough for one service running all month).
- **Turso free limits:** 5 GB of storage, 500 million row reads and 10 million row writes a month.
  Pictures are stored in the database, so a 5 MB photo uses about 5 MB. A studio site stays far below the limits.
- **Backups.** Turso keeps your data safe, but it is good practice to keep a copy. Your local
  `data/inkster.db` is only a snapshot from the day you copied it.
- **Updates.** Push new code to GitHub as before; Render redeploys and the data stays on Turso.

---

## B. Paid disk option

If you later move to a paid Render instance you can keep a SQLite file on a persistent disk instead of Turso:
Disk → Add Disk (mount path `/var/data`, 1 GB), then set `DB_FILE=/var/data/inkster.db`,
`UPLOAD_DIR=/var/data/uploads` and `NODE_ENV=production`, and do **not** set `TURSO_DATABASE_URL`.
`render.yaml` describes this setup. Copy your data to the disk with `scp -s` as described in the
Render docs. Also, on a paid instance, SMTP works, so `SMTP_*` can replace Brevo.

---

## Environment variables

| Key | What it is |
|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Your free Turso database (option A). When set, the SQLite file is not used. |
| `ADMIN_PASSWORD` | Password for `/admin/`. **Required**: empty disables the admin area. |
| `JWT_SECRET` | Signs the admin cookie. Keep it stable (admin is signed out on restart if missing). |
| `APP_URL` | Public URL, e.g. `https://ink-nation.onrender.com`. No trailing slash. Render's own address is used if empty. |
| `ADMIN_EMAIL` | Where the studio's copies of booking and payment emails go. Falls back to the studio email in the admin area. |
| `BREVO_API_KEY` + `MAIL_FROM` | Email over the web (works on Render free). |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | Email over SMTP (your computer, or paid hosting). |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Card payments. Leave empty to hide cards. |
| `SLOTS_PER_ARTIST_PER_DAY` | Sessions per artist per day. Default `2`. |
| `DB_FILE` / `UPLOAD_DIR` | Only for the paid-disk option or your own computer. |
| `UPLOAD_STORAGE` | `db` or `disk`. Automatic: `db` when Turso is used, `disk` otherwise. |
| `NODE_ENV=production` | Makes the admin cookie HTTPS-only. Do not set it on `http://localhost`. |

---

## Moving your existing data from MySQL/XAMPP

The switch to SQLite starts with starter content. To bring the real content across (on your computer):

```powershell
npm run db:init
npm install mysql2 --no-save --no-package-lock
npm run db:import
```

The script reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` from `.env`, copies every
table into `data/inkster.db`, and replaces the starter rows. Then use step 3 above to send it to Turso.

---

## Netlify

Netlify can serve the HTML/CSS/JS in `public/`, but **the site needs the Express API** for bookings,
reviews, prices, orders, payments, admin sign-in and uploads. Host the whole app on Render (or another
Node host). Pointing Netlify at the Render URL is not needed.

---

## Local development

No MySQL or XAMPP needed.

```powershell
cd inkster-app
npm install
Copy-Item .env.example .env    # then edit ADMIN_PASSWORD and JWT_SECRET
npm run dev                    # http://localhost:3000 and /admin/ (data/inkster.db is created for you)
npm test                       # uses its own file, never your real data
```

Reset everything by deleting `data/inkster.db` and restarting.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Site shows Manuel, Dalia, Laura (starter content) | Step 2 was not done, or it was run against a different Turso database. Run `node scripts/push-to-turso.js` again. |
| Log says `Database: /opt/render/...` | `TURSO_DATABASE_URL` is missing on Render. Add it (and the token) and redeploy. |
| `Database setup failed` with a 401 or `Unauthorized` | `TURSO_AUTH_TOKEN` is wrong or expired. Make a new token in Turso. |
| `Database setup failed` with `ENOTFOUND` | `TURSO_DATABASE_URL` has a typo. It must look like `libsql://name-user.turso.io`. |
| Photos missing after copying | They were not in your `uploads/` folder. Upload them again in the admin area. |
| Admin area returns 503 | `ADMIN_PASSWORD` is empty. Set it and redeploy. |
| Admin signs out on every restart | `JWT_SECRET` is missing. Set one long random value. |
| No emails on Render | SMTP is blocked on the free plan. Use Brevo (step 4). |
| Card payment says unavailable | `STRIPE_SECRET_KEY` is empty or wrong, or `APP_URL` is wrong. |
| Stripe payment stays unpaid | Webhook URL/secret wrong. |
| `Cannot find module 'node:sqlite'` | Node is older than 22.5. Render: `.node-version` should say `22.20.0`. |
| First page load takes a minute | The free Render server was asleep. Normal on the free plan. |
