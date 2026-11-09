# Update 3: free hosting on Render (data kept in a free Turso database)

Why the live site "worked" but lost its data: Render's free plan erases its own files on every deploy, restart and
after 15 minutes without visitors. A SQLite *file* (and uploaded photos) cannot survive there, and disks cost money.
This update keeps the data on Turso (free, no credit card) and stores photos and the video inside it too.

## What changed (copy these over your project, replacing the old ones)

    config/db.js               uses your local file as before, or Turso when TURSO_DATABASE_URL is set
    server.js                  serves photos kept in the database, clearer startup messages
    sql/schema.sql             new table ink_files (photos/video in pieces)
    src/lib/images.js          photos go to the database automatically when Turso is used
    src/lib/video.js           same for the studio video
    src/lib/mailer.js          emails over Brevo's web API (Render free blocks Gmail's SMTP ports)
    src/lib/payments.js        uses Render's own address if APP_URL is empty
    src/middleware/auth.js     admin cookie is HTTPS-only whenever the page is served over HTTPS
    scripts/init-db.js         checks that Turso enforces links between tables
    scripts/push-to-turso.js   NEW: copies your data/inkster.db and uploads/ into Turso (run once)
    scripts/api-test.js        76 checks (68 before), can also test against a libSQL server
    package.json, package-lock.json   adds @libsql/client, updates nodemailer (security fixes)
    render.yaml, DEPLOY.md, README.md  free-plan instructions

Nothing else is touched. Your data/ and uploads/ folders are not in this zip.

## Do this

1. Follow DEPLOY.md, steps 1 to 3 (Turso account, copy your data once, tell Render the two Turso values).
2. In PowerShell, in the project folder, after copying the files:

       npm install
       npm test            # 76 passed, 0 failed

3. Commit and push (separate lines in PowerShell):

       git add .
       git commit -m "Free hosting with Turso"
       git push

Do not commit data/ or uploads/ (they are already ignored).
