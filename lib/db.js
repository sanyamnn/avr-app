// One generic document table backs every collection the page uses
// (reads, attendees, bookings, requests). Postgres via Vercel's
// POSTGRES_URL (Neon / Vercel Postgres) using the plain pg driver.
import pg from "pg";

const { Pool } = pg;
let pool, ready;

export function getPool() {
  if (!pool) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("POSTGRES_URL is not set");
    pool = new Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export async function ensureSchema() {
  if (!ready) {
    ready = getPool().query(`
      CREATE TABLE IF NOT EXISTS docs (
        collection text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        ts text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS docs_updated ON docs (collection, updated_at);
    `).catch(e => { ready = null; throw e; });
  }
  return ready;
}

const COLL = /^[a-z][a-z0-9_-]{0,40}$/;
const ID = /^[A-Za-z0-9@._:+-]{1,200}$/;
export function checkPath(collection, id) {
  if (!COLL.test(collection || "")) throw Object.assign(new Error("bad collection"), { status: 400 });
  if (id != null && !ID.test(id)) throw Object.assign(new Error("bad id"), { status: 400 });
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function listDocs(collection, { limit = 500, since = null } = {}) {
  checkPath(collection);
  await ensureSchema();
  const lim = Math.max(1, Math.min(2000, Number(limit) || 500));
  const params = [collection];
  let where = "collection = $1";
  if (since) { params.push(since); where += ` AND updated_at > $${params.length}`; }
  params.push(lim);
  const { rows } = await getPool().query(
    `SELECT id, data, updated_at FROM docs WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`, params);
  return rows.map(r => ({ id: r.id, data: r.data, updatedAt: r.updated_at.toISOString() }));
}

export async function getDoc(collection, id) {
  checkPath(collection, id);
  await ensureSchema();
  const { rows } = await getPool().query("SELECT id, data, updated_at FROM docs WHERE collection=$1 AND id=$2", [collection, id]);
  return rows[0] ? { id: rows[0].id, data: rows[0].data, updatedAt: rows[0].updated_at.toISOString() } : null;
}

export async function setDoc(collection, id, data) {
  checkPath(collection, id);
  await ensureSchema();
  await getPool().query(
    `INSERT INTO docs (collection, id, data, ts, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts, updated_at = now()`,
    [collection, id, JSON.stringify(data), data && data.ts ? String(data.ts) : null]);
  return { id };
}

export async function updateDoc(collection, id, patch) {
  checkPath(collection, id);
  await ensureSchema();
  const { rows } = await getPool().query(
    `UPDATE docs SET data = data || $3::jsonb, ts = COALESCE($4, ts), updated_at = now()
     WHERE collection=$1 AND id=$2 RETURNING id`,
    [collection, id, JSON.stringify(patch), patch && patch.ts ? String(patch.ts) : null]);
  if (!rows[0]) throw Object.assign(new Error("not found"), { status: 404 });
  return { id };
}

export async function deleteDoc(collection, id) {
  checkPath(collection, id);
  await ensureSchema();
  await getPool().query("DELETE FROM docs WHERE collection=$1 AND id=$2", [collection, id]);
  return { id };
}

export async function upsertMany(collection, docs, { overwrite = false } = {}) {
  checkPath(collection);
  await ensureSchema();
  const client = await getPool().connect();
  let written = 0;
  try {
    await client.query("BEGIN");
    for (const d of docs) {
      checkPath(collection, d.id);
      const r = await client.query(
        `INSERT INTO docs (collection, id, data, ts, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (collection, id) DO ${overwrite ? "UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts, updated_at = now()" : "NOTHING"}`,
        [collection, d.id, JSON.stringify(d.data), d.data && d.data.ts ? String(d.data.ts) : null]);
      written += r.rowCount;
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  return written;
}
