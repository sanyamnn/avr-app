// GET  /api/db?collection=reads&limit=500[&since=ISO]   list (newest first)
// GET  /api/db?collection=reads&id=pre-acr-org             one document
// POST /api/db  {op:"add"|"set"|"update"|"delete", collection, id?, data?}
import { listDocs, getDoc, setDoc, updateDoc, deleteDoc, newId } from "../lib/db.js";
import { authorized, deny, readJson } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.BOOTH_PASSCODE) return deny(res, 503, "BOOTH_PASSCODE is not set on the server");
  if (!authorized(req)) return deny(res, 401, "passcode");
  try {
    if (req.method === "GET") {
      const { collection, id, limit, since } = req.query || {};
      if (id) { const d = await getDoc(collection, id); return res.status(200).json({ doc: d }); }
      const docs = await listDocs(collection, { limit, since });
      return res.status(200).json({ docs, now: new Date().toISOString() });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const { op, collection } = body; let { id, data } = body;
      if (op === "add") { id = newId(); await setDoc(collection, id, data || {}); return res.status(200).json({ id }); }
      if (op === "set") { await setDoc(collection, id, data || {}); return res.status(200).json({ id }); }
      if (op === "update") { await updateDoc(collection, id, data || {}); return res.status(200).json({ id }); }
      if (op === "delete") { await deleteDoc(collection, id); return res.status(200).json({ id }); }
      return deny(res, 400, "unknown op");
    }
    res.setHeader("Allow", "GET, POST");
    return deny(res, 405, "method");
  } catch (e) {
    return deny(res, e.status || 500, e.message || "server error");
  }
}
