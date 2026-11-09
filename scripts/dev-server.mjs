// Minimal local host for the two Vercel functions plus the static files.
// Needs POSTGRES_URL and BOOTH_PASSCODE in the environment.
//   POSTGRES_URL=postgres://... BOOTH_PASSCODE=test node scripts/dev-server.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbFn = (await import(path.join(root, "api/db.js"))).default;
const seedFn = (await import(path.join(root, "api/seed.js"))).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };

function wrap(req, res) {
  const u = new URL(req.url, "http://x");
  req.query = Object.fromEntries(u.searchParams);
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  return u;
}

http.createServer(async (req, res) => {
  const u = wrap(req, res);
  try {
    if (u.pathname === "/api/db") return await dbFn(req, res);
    if (u.pathname === "/api/seed") return await seedFn(req, res);
    let p = u.pathname === "/" ? "/index.html" : u.pathname;
    const f = path.join(root, p);
    if (!f.startsWith(root)) return res.status(403).end();
    res.setHeader("content-type", TYPES[path.extname(f)] || "application/octet-stream");
    res.end(await readFile(f));
  } catch (e) { res.status(e.code === "ENOENT" ? 404 : 500).end(String(e.message)); }
}).listen(process.env.PORT || 3123, () => console.log("dev server on", process.env.PORT || 3123));
