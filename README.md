# AI Visibility Read

Altudo's booth tool for the Scrunch AI Visibility Hub, Sitecore Symposium 2026. Type a prospect's domain and two competitors; the app pulls AI referral traffic, Google AI Overview citations and AI landing pages, fills the six worksheet steps, suggests the quadrant and three moves, drafts the email, builds the two-page PDF and keeps a shared capture log. It runs on any host with Docker or Node 20+, with its own API keys, and needs nobody's laptop or login.

## Deploy in ten minutes (Render)

1. Push this folder to a GitHub repo (private is fine).
2. On render.com: New, Blueprint, pick the repo. Render reads `render.yaml`: a Docker web service with a 1 GB disk at `/app/data` so the log survives restarts.
3. Set the environment variables when prompted: `APP_PASSWORD` (the team password), `SW_API_KEY`, `SEMRUSH_API_KEY`. Leave `MOCK` at 0. `LOG_WEBHOOK_URL` is optional (below).
4. Open the service URL, sign in with the team password, go to the Diagnostics tab and click Run check. All four checks should be green. If a Similarweb check says 404, the path for that endpoint differs in your account's API reference: set `SW_AI_OVERVIEW_PATH`, `SW_AI_LANDING_PATH` or `SW_VISITS_PATH` in the environment to the documented path (keep `{domain}` as the placeholder) and redeploy.

Any other host works the same way: `docker build -t avr . && docker run -p 8080:8080 -v avr-data:/app/data -e APP_PASSWORD=... -e SW_API_KEY=... -e SEMRUSH_API_KEY=... avr`. Or without Docker: `npm install && APP_PASSWORD=... SW_API_KEY=... SEMRUSH_API_KEY=... node server.js`.

## Try it with sample data

`MOCK=1 APP_PASSWORD=test node server.js`, then open http://localhost:8080. Every read returns the same sample numbers; no keys needed.

## Keep the log somewhere durable (optional)

The log is a JSON file on the server's disk, downloadable as CSV from the Capture log tab. To mirror every saved row into a Google Sheet: in the Sheet, Extensions, Apps Script, paste

```
function doPost(e){ var r=JSON.parse(e.postData.contents); var s=SpreadsheetApp.getActiveSheet();
  s.appendRow([r.ts,r.company,r.domain,r.name,r.role,r.email,r.sitecore,r.top50,r.referrer,r.vscore,r.vrank,r.vis,r.aioInside,r.aioTotal,r.lastMonth,r.aiVisits,r.aiVisitsA,r.aiVisitsB,r.share,r.topPage,r.quadrant,(r.moves||[]).join(' | '),r.next,r.slot,r.heat,r.lead,r.notes,r.emailSent,r.prepulled]);
  return ContentService.createTextOutput('ok'); }
```

Deploy as a web app (execute as you, anyone can access), copy the URL into `LOG_WEBHOOK_URL`.

## Costs per read

Three domains: about 115 Similarweb data credits (AI traffic overview 36 each, visits 1 each, landing pages 8) and about 300 Semrush API units (30 rows). The Pre-pull queue runs reads in sequence at the same cost each.

## What is where

- `server.js`: web server, team-password login, `/api/read`, the capture log, CSV, diagnostics.
- `providers.js`: the Similarweb and Semrush calls and the result shape. Paths and bases come from environment variables.
- `public/index.html`: the whole UI, one file. `public/vendor/jspdf.umd.min.js` builds the PDF in the browser.
- `data/log.json`: the capture log (created on first save).

## Semrush note

Google AI Overview is SERP feature code 52 in the Semrush API. The "Cited in AI Overview" number is: of the site's top 30 keywords by volume where Google shows an AI Overview, how many have the site inside it (`Fp` contains 52). Verify one keyword against a live Google search on first use.
