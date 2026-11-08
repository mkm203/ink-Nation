# Update 2: new Team section, studio video, customer emails

Install this **on top of the folder you already have** (the same way as the first update). The zip contains every file from update 1 plus the new ones, so it is safe to copy it all over, even if some files are identical.

## What changed

1. **Our team** now follows the video: a full-width strip that slides **sideways as you scroll**, one artist per panel, with the next artist peeking in from the right. It takes far less space than before. There are also ← → buttons. On phones (and for visitors who prefer less motion) it is a normal swipeable strip.
2. **Each artist's work sits beside their profile.** The pieces shown are the items in **Admin > Work** that have that artist selected. Clicking a piece opens it in a viewer right there (with ← → between that artist's pieces). It no longer jumps to the Recent work section. The "See more" button on a Recent work slide is now "Meet the artist" and slides the strip to that artist.
3. **A video plays after the team section** and grows to full screen as you scroll, like the design. A sample loop (cut from your design video) is included. Replace it with your own in **Admin > Studio > Studio video** (MP4 or WebM, up to 30 MB, a short silent loop is best).
4. **Emails to customers** (details below).

## Step 1. Copy the files

Unzip `ink-nation-update-2.zip` and copy the contents of its `inkster-app` folder over your own `inkster-app` folder (Replace the files in the destination). New files in this update:

| File | Goes to (inside your `inkster-app` folder) |
|---|---|
| `src\lib\mailer.js`, `src\lib\emails.js`, `src\lib\video.js` | `inkster-app\src\lib\` (new) |
| `public\css\team.css` | `inkster-app\public\css\` (new) |
| `public\media\studio-loop.mp4`, `studio-loop.jpg` | `inkster-app\public\media\` (new folder, create it if Windows does not) |
| `UPDATE2.md` | `inkster-app\` (new) |

Replaced files: `package.json`, `.env.example`, `scripts\api-test.js`, `src\routes\public.js`, `src\routes\shop.js`, `src\routes\admin.js`, `src\models\orders.js`, `public\index.html`, `public\js\app.js`, `public\admin\admin.js`, plus the update 1 files, unchanged.

Your `.env`, `uploads\` and database are not touched.

## Step 2. Install and restart

```powershell
cd path\to\inkster-app
npm install
npm run dev
```

`npm install` adds one package (`nodemailer`). There is no database change in this update. Press `Ctrl+F5` in the browser to load the new page.

## Emails: what is sent and when

| When | Subject starts with | What it says |
|---|---|---|
| A booking request is made | `Booking request received` | Reference code, size, artist, date, and how to pay the deposit |
| A payment is reserved (shop order or booking deposit), still unpaid | `Payment reserved` | The items, the total, exactly how to pay (card link / Zelle or Chime account and the code to write / Bitcoin amount and address) and that it is held 24 hours |
| The payment is confirmed (by Stripe, or when you set the order to Paid) | `Payment received` | Thank you, the total, and what happens next. Sent once only |

The emails use your studio name and details from Admin > Studio, and a customer who replies reaches your studio email.

### Turn emails on (one-time, in `.env`)

Without this the whole site still works, but **no email is sent** (the console says so once). Open `.env` with `notepad .env` and add:

**Using a Gmail account** (simplest):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourstudio@gmail.com
SMTP_PASS=your-16-letter-app-password
MAIL_FROM="Ink Nation <yourstudio@gmail.com>"
APP_URL=http://localhost:3000
```

1. In your Google account turn on **2-Step Verification**.
2. Open https://myaccount.google.com/apppasswords, create an app password named "Ink Nation", and paste the 16 letters (without spaces) as `SMTP_PASS`. Your normal Gmail password will not work.
3. Restart the app (`Ctrl+C`, then `npm run dev`).

Other mail services work the same way (any provider that gives you an SMTP host, port, user and password, for example your hosting's mailbox or Brevo). Use port 587, or 465 for SSL.

**`APP_URL`** is the public address of the site. The buttons and links in the emails use it, so when the site is online set it to the real address (for example `https://inknation.com`). On your own computer, links only work on your computer.

### Test it

Make a booking on the site with an email address you can read. You should get "Booking request received" within seconds. Then pay its deposit with Zelle or Bitcoin to get "Payment reserved", and set the order to Paid in Admin > Orders & payments to get "Payment received". Check the spam folder the first time.

Good to know: if the mail server is down or the details are wrong, the customer's booking or payment still goes through; the error is written in the PowerShell window as `Email to ... failed`. Gmail allows roughly 500 emails a day. I tested sending through a real SMTP connection and the emails' layout, but not through Gmail itself.

## Setting up the Team section

- **Admin > Artists:** upload each artist's photo (tall portraits look best). Without one, a drawn portrait is shown.
- **Admin > Work:** each piece needs its **Artist** selected, and a photo if you have one. Those pieces appear beside that artist. An artist with no work shows only their profile.
- The pieces still also appear in the full-screen Recent work slides.

## If something goes wrong

| Problem | Fix |
|---|---|
| `Cannot find module 'nodemailer'` | Run `npm install`. |
| The team section looks old, or the video is missing | Copy `public\css\team.css` and `public\media\` and press `Ctrl+F5`. |
| No emails arrive | Check `.env` has all of `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, restart, and watch the PowerShell window for `Email to ... failed`. For Gmail use an app password. |
| Links in emails open `localhost` | Set `APP_URL` to your real site address. |
| Video does not play on a phone | It must be an MP4 (H.264) or WebM, and silent. Autoplay is blocked for videos with sound. |
