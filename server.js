import express from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runRead, diagnostics } from "./providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "log.json");
const PASSWORD = process.env.APP_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update(PASSWORD + "avr").digest("hex");
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- tiny JSON store with atomic writes
function readLog() { try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch { return []; } }
function writeLog(rows) { const tmp = LOG_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(rows, null, 1)); fs.renameSync(tmp, LOG_FILE); }
async function mirror(row) {
  const url = process.env.LOG_WEBHOOK_URL; if (!url) return;
  try { await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(row) }); } catch (e) { console.error("webhook failed", e.message); }
}

// ---- auth: one shared team password, signed cookie
const token = () => crypto.createHmac("sha256", SECRET).update("ok").digest("hex");
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.post("/login", (req, res) => {
  if (!PASSWORD) return res.status(500).json({ error: "APP_PASSWORD is not set on the server" });
  if ((req.body.password || "") !== PASSWORD) return res.status(401).json({ error: "Wrong password" });
  res.cookie("avr", token(), { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 }); res.json({ ok: true });
});
app.post("/logout", (req, res) => { res.clearCookie("avr"); res.json({ ok: true }); });
const guard = (req, res, next) => { if (!PASSWORD || req.cookies.avr === token()) return next(); res.status(401).json({ error: "login" }); };
app.get("/healthz", (req, res) => res.json({ ok: true, mock: process.env.MOCK === "1" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- API
app.get("/api/me", guard, (req, res) => res.json({ ok: true, mock: process.env.MOCK === "1" }));
app.post("/api/read", guard, async (req, res) => {
  const { domain, compA, compB, country, semdb } = req.body || {};
  if (!domain) return res.status(400).json({ error: "domain required" });
  try { res.json(await runRead({ domain, compA, compB, country, semdb })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get("/api/diag", guard, async (req, res) => res.json(await diagnostics(req.query.domain || "example.com")));
app.get("/api/log", guard, (req, res) => res.json(readLog()));
app.post("/api/log", guard, async (req, res) => {
  const rows = readLog(); const row = req.body || {};
  if (row.id) { const i = rows.findIndex(r => r.id === row.id); if (i >= 0) rows[i] = { ...rows[i], ...row, updatedAt: new Date().toISOString() }; else rows.push(row); }
  else { row.id = crypto.randomUUID(); row.ts = row.ts || new Date().toISOString(); rows.push(row); }
  writeLog(rows); mirror(rows.find(r => r.id === row.id)); res.json({ ok: true, id: row.id });
});
app.post("/api/log/:id/sent", guard, (req, res) => { const rows = readLog(); const r = rows.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ error: "no row" }); r.emailSent = true; r.emailSentAt = new Date().toISOString(); writeLog(rows); res.json({ ok: true }); });
app.delete("/api/log/:id", guard, (req, res) => { writeLog(readLog().filter(r => r.id !== req.params.id)); res.json({ ok: true }); });
app.get("/api/log.csv", guard, (req, res) => {
  const rows = readLog(); const cols = ["ts", "company", "domain", "name", "role", "email", "sitecore", "top50", "referrer", "vscore", "vrank", "vis", "aioInside", "aioTotal", "lastMonth", "aiVisits", "aiVisitsA", "aiVisitsB", "share", "topPage", "quadrant", "moves", "next", "slot", "heat", "lead", "notes", "emailSent", "prepulled"];
  const q = v => '"' + String(Array.isArray(v) ? v.join(" | ") : (v ?? "")).replace(/"/g, '""') + '"';
  res.setHeader("content-type", "text/csv"); res.setHeader("content-disposition", "attachment; filename=symposium-capture-log.csv");
  res.send([cols.join(",")].concat(rows.map(r => cols.map(c => q(r[c])).join(","))).join("\n"));
});
app.listen(PORT, () => console.log(`AI Visibility Read on :${PORT} (mock=${process.env.MOCK === "1"}, data=${DATA_DIR})`));
