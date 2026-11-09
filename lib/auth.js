// Shared booth passcode. Set BOOTH_PASSCODE in Vercel; the page asks once
// and keeps it in the browser. Reads and writes both require it because
// the log holds attendee names and emails.
import { timingSafeEqual } from "node:crypto";

export function authorized(req) {
  const want = process.env.BOOTH_PASSCODE || "";
  if (!want) return false;
  const got = String(req.headers["x-booth-pass"] || "");
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deny(res, status, message) {
  res.status(status).json({ error: message });
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}
