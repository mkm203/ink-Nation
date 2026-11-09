# Update 4: fast photos and video, Stripe return page, easier uploads

## What was wrong

- **Slow photos, video never loading.** Photos and the video were stored inside Turso in 256 KB pieces. Every view made
  the free Render server fetch them piece by piece over the internet, and the server forgets its copy each time it sleeps.
- **Stripe sent customers to localhost.** The return address comes from `APP_URL`. When it is set to
  `http://localhost:3000` (copied from `.env`), Stripe redirects there after paying.
- **Uploads failing.** Phone photos are often over 5 MB and were refused; the video went to Turso in pieces.

## What changed

    src/lib/cloudinary.js      NEW: stores photos and video on Cloudinary (signed uploads, deletes old files)
    src/lib/moveMedia.js       NEW: moves photos uploaded before Cloudinary, in one click
    src/lib/images.js          uses Cloudinary when CLOUDINARY_URL is set (otherwise unchanged)
    src/lib/video.js           same for the video
    src/lib/payments.js        ignores a localhost APP_URL on Render, adds https:// if missing
    src/routes/admin.js        direct browser-to-Cloudinary video upload, "move older photos" endpoint
    public/admin/admin.js      big photos resized in the browser, upload progress, video progress, move button
    public/js/app.js           smaller image sizes where pictures are small, video poster frame
    public/js/discover.js      smaller image size for price photos
    server.js                  startup log shows storage and the public address
    scripts/api-test.js        82 checks (76 before)
    render.yaml, DEPLOY.md     CLOUDINARY_URL, APP_URL notes

## Do this

1. On Render → Environment: set `APP_URL` to `https://YOUR-APP.onrender.com` (not localhost).
2. Follow DEPLOY.md step 3b: create a free Cloudinary account and add `CLOUDINARY_URL` on Render.
3. Push this code. After the deploy, open Admin → Studio and click **Move them now** once.
