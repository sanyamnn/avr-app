// POST /api/seed            loads seed/reads.json into the reads collection,
//                           skipping rows that already exist (booth edits win)
// POST /api/seed?overwrite=1 replaces every seeded row with the file's version
// GET  /api/seed            counts: rows in the file, rows in the database
import { readFile } from "node:fs/promises";
import path from "node:path";
import { upsertMany, listDocs } from "../lib/db.js";
import { authorized, deny } from "../lib/auth.js";

async function loadSeed() {
  const p = path.join(process.cwd(), "seed", "reads.json");
  return JSON.parse(await readFile(p, "utf8"));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authorized(req)) return deny(res, 401, "passcode");
  try {
    const seed = await loadSeed();
    if (req.method === "GET") {
      const inDb = await listDocs("reads", { limit: 2000 });
      return res.status(200).json({ inFile: seed.length, inDb: inDb.length, prepulledInDb: inDb.filter(d => d.data && d.data.prepulled).length });
    }
    if (req.method === "POST") {
      const overwrite = String((req.query || {}).overwrite || "") === "1";
      const written = await upsertMany("reads", seed, { overwrite });
      return res.status(200).json({ inFile: seed.length, written, overwrite });
    }
    res.setHeader("Allow", "GET, POST");
    return deny(res, 405, "method");
  } catch (e) {
    return deny(res, e.status || 500, e.message || "server error");
  }
}
