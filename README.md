# AI Visibility Read, Vercel edition

Altudo's booth tool for the Scrunch AI Visibility Hub, Sitecore Symposium 2026. The same two-page read as the Claude page, hosted on Vercel with its own database, so reps need no claude.ai login.

What this build does: 236 pre-loaded reads with six-month competitor trends, typeahead, verdict and index, editable report, PDF via print, email draft, shared capture log, attendees and follow-up schedule.

What it does not do yet: live Similarweb pulls for a brand that is not pre-loaded, and model recall. Both still run on the Claude page. The API routes for them are the next step once a Similarweb API key and an Anthropic key are in Vercel.

## Deploy, about ten minutes

1. **Import the repo.** vercel.com, Add New, Project, pick `sanyamnn/avr-app`, branch `main`. Framework preset: Other. No build command. Deploy.
2. **Add the database.** In the project: Storage, Create Database, Postgres (Neon). Accept the defaults and connect it to the project. This sets `POSTGRES_URL` automatically.
3. **Set the passcode.** Settings, Environment Variables: `BOOTH_PASSCODE` = the phrase the team will type. Apply to Production. Redeploy (Deployments, three dots, Redeploy) so the function picks it up.
4. **Open the site and enter the passcode.** On the first open the page finds an empty database and loads the 236 pre-pulled reads itself; the Reads tab fills within a few seconds.
5. **Check.** Type `ascension` in Find, pick the row, see the trend chart with three competitors, add a name, Save, confirm it appears in Reads on a second device.

To reload rows later (after a sync), in the browser console run
`fetch('/api/seed',{method:'POST',headers:{'x-booth-pass':localStorage.getItem('avr-pass')}}).then(r=>r.json()).then(console.log)`.
That never overwrites a row a rep has saved; add `?overwrite=1` to the URL to force the file's version over everything.

## Updating the page or the data

The Claude page is the source of truth. After it or the pre-pull rows change:

```
python3 scripts/sync.py /path/to/visibility_read.html /path/to/prepull/docs2
git commit -am "sync" && git push
```

Vercel redeploys on push. Re-run the seed call to pick up new or changed rows (existing booth edits are kept).

## What is where

- `index.html`: the whole UI, generated from the Claude page by `scripts/sync.py`, plus one line that loads `shim.js`.
- `shim.js`: stands in for the Claude runtime. Database calls go to `/api/db`; downloads use the browser; the passcode is kept in the browser.
- `api/db.js`, `api/seed.js`: Vercel functions. `lib/db.js` holds the one `docs` table (collection, id, jsonb) that backs reads, attendees, bookings and requests.
- `seed/reads.json`: the 236 pre-pulled rows.
- `scripts/dev-server.mjs`: local host for the functions. `POSTGRES_URL=... BOOTH_PASSCODE=... node scripts/dev-server.mjs`, then open http://localhost:3123.

The earlier Express and Render version lives on the `render-legacy` branch.

## Data note

Traffic figures are panel-based estimates from a third-party dataset licensed by Altudo. The capture log holds attendee names and emails; the passcode gates reads and writes, and the database is private to the Vercel project.
