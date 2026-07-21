# TMA Leaks

Anonymous post board. Text and images, no accounts. Backend on Render, frontend on GitHub Pages.

## What's here

```
tma-leaks/
├── backend/          Node/Express API + SQLite storage
│   ├── server.js      routes: post, list, report, admin
│   ├── db.js           database setup
│   ├── moderation.js    text filter (phone/email/handles/blocked terms)
│   └── uploads/         uploaded images land here (re-encoded, EXIF stripped)
└── frontend/          Static site (no build step)
    ├── index.html
    ├── styles.css
    ├── app.js
    └── config.js        <- set your backend URL here
```

## How the safety stuff works (read this before you launch)

You asked for "post anything," so this is intentionally light-touch, but it's not
zero-moderation — a fully open anonymous image board is how you end up hosting
something illegal without meaning to. Here's what's actually in place, and what's still on you:

- **Text filter** (`moderation.js`): blocks phone numbers, emails, social handles, and
  a starter list of blocked terms (empty by default — add your own words to
  `BLOCKED_TERMS`).
- **Images**: re-encoded and stripped of EXIF/GPS metadata on upload (so posters don't
  accidentally leak their location), capped at 5MB, resized. **There is no automated
  NSFW/CSAM detection in this starter kit** — that's the biggest real gap. Report-based
  takedown is the fallback: 3 reports auto-hides a post immediately.
- **Reports**: one per IP per post, auto-hides at the threshold (`REPORT_HIDE_THRESHOLD`
  in `.env`, default 3). Hidden posts stay in the database so you can review and
  permanently delete or restore them from the admin panel.
- **Admin access**: `GET/POST/DELETE /api/admin/...` routes require an `x-admin-key`
  header matching `ADMIN_KEY` in your `.env`. There's no UI for this yet — see
  "Checking reports" below for a quick way to use it without building one.
- **Rate limiting**: 5 posts per IP per 10 minutes, to stop flooding.

**Before you actually share the link with people**, I'd strongly recommend adding a
real image moderation API call inside `processAndSaveImage()` in `server.js` —
options with free tiers: Sightengine, Hive Moderation, or Google Cloud Vision
SafeSearch. It's a ~10 line addition (call the API, reject the upload if it comes
back flagged) and it closes the biggest hole here. Happy to add it if you want —
just tell me which provider and I'll wire it in.

## 1. Deploy the backend to Render

1. Push this whole `tma-leaks` folder to a GitHub repo.
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo.
3. Set:
   - **Root directory**: `backend`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Add environment variables (Render dashboard → Environment):
   - `ADMIN_KEY` = a long random string (this is your admin password — keep it secret)
   - `IP_SALT` = another random string
   - `REPORT_HIDE_THRESHOLD` = `3` (or whatever you want)
5. Deploy. Render gives you a URL like `https://tma-leaks-backend.onrender.com`.

**Important limitation**: Render's free tier has an *ephemeral filesystem* — the
SQLite database and uploaded images get wiped on every redeploy or when the free
instance spins down from inactivity and restarts. That's fine for messing around,
but if you want posts to actually persist long-term, you have two options:
- Upgrade to a paid Render instance with a persistent disk, or
- Swap SQLite for Render's free-tier Postgres and images for a free object storage
  bucket (e.g. Cloudflare R2 free tier). I can help wire either of these up if you
  want the site to be durable.

## 2. Deploy the frontend to GitHub Pages

1. In `frontend/config.js`, set `API_BASE_URL` to your Render URL from step 1:
   ```js
   const API_BASE_URL = "https://tma-leaks-backend.onrender.com";
   ```
2. In your GitHub repo settings → Pages → set source to the `frontend` folder
   (or `main` branch `/frontend` directory, or push `frontend`'s contents to a
   `gh-pages` branch — whichever you're used to).
3. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

## 3. Checking reports / moderating (no UI yet)

Until you want an actual admin dashboard page, you can hit the admin API directly.
In a terminal:

```bash
# List all posts (including hidden ones) with report counts
curl https://tma-leaks-backend.onrender.com/api/admin/posts \
  -H "x-admin-key: YOUR_ADMIN_KEY"

# Permanently delete a post by id
curl -X DELETE https://tma-leaks-backend.onrender.com/api/admin/posts/POST_ID \
  -H "x-admin-key: YOUR_ADMIN_KEY"

# Restore a post that got auto-hidden by mistake
curl -X POST https://tma-leaks-backend.onrender.com/api/admin/posts/POST_ID/unhide \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

Say the word if you'd like a proper password-protected admin page instead of curl commands —
it's a quick add.

## 4. Running it locally first (recommended before deploying)

```bash
# backend
cd backend
cp .env.example .env   # then edit ADMIN_KEY inside
npm install
npm start               # runs on http://localhost:3001

# frontend, in a second terminal
cd frontend
python3 -m http.server 8080   # or `npx serve`
# visit http://localhost:8080
```

`frontend/config.js` already points at `http://localhost:3001` by default, so local
testing works out of the box — just remember to point it at your real Render URL
before deploying.
