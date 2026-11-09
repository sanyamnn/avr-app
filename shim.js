// Stands in for the Claude artifact runtime (window.claude.use) on Vercel.
//   db        -> /api/db on Vercel Postgres, Firestore-shaped, polling snapshots
//   downloads -> plain browser download
//   user      -> write allowed once the booth passcode is in
//   mcp       -> null (live Similarweb reads need the Claude page or the API routes in v2)
//   sample    -> null (model recall needs the Claude page or the API routes in v2)
(() => {
  const KEY = "avr-pass";
  const POLL_MS = 7000;
  let pass = null;
  try { pass = localStorage.getItem(KEY) || null; } catch (e) {}

  function askPass(msg) {
    const p = prompt(msg || "Booth passcode");
    if (p == null) return null;
    pass = p.trim();
    try { localStorage.setItem(KEY, pass); } catch (e) {}
    return pass;
  }
  async function api(method, query, body) {
    if (!pass && !askPass()) throw Object.assign(new Error("No passcode"), { code: "unauthenticated" });
    const url = "/api/db" + (query ? "?" + new URLSearchParams(query).toString() : "");
    const r = await fetch(url, { method, headers: { "content-type": "application/json", "x-booth-pass": pass }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) {
      try { localStorage.removeItem(KEY); } catch (e) {}
      pass = null;
      if (askPass("That passcode was not accepted. Booth passcode:")) return api(method, query, body);
      throw Object.assign(new Error("Not signed in"), { code: "unauthenticated" });
    }
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (e) {} throw Object.assign(new Error(m), { code: "api_" + r.status }); }
    return r.json();
  }
  window.__avrApi = api;
  window.__avrSignOut = () => { try { localStorage.removeItem(KEY); } catch (e) {} pass = null; location.reload(); };

  const snap = (id, data) => ({ id, data: () => data, exists: !!data });

  function docRef(path) {
    const [collection, id] = path.split("/");
    return {
      id,
      async get() { const { doc } = await api("GET", { collection, id }); return snap(id, doc ? doc.data : null); },
      async set(data) { await api("POST", null, { op: "set", collection, id, data }); },
      async update(data) { await api("POST", null, { op: "update", collection, id, data }); },
      async delete() { await api("POST", null, { op: "delete", collection, id }); },
      onSnapshot(cb, err) {
        let stop = false;
        const tick = async () => { if (stop) return; try { const { doc } = await api("GET", { collection, id }); if (!stop) cb(snap(id, doc ? doc.data : null)); } catch (e) { if (err) err(e); } if (!stop) setTimeout(tick, POLL_MS); };
        tick();
        return () => { stop = true; };
      }
    };
  }

  function collectionRef(collection) {
    const q = { limit: 500, orderBy: null };
    const self = {
      orderBy(field, dir) { q.orderBy = [field, dir || "asc"]; return self; },
      limit(n) { q.limit = n; return self; },
      async add(data) { const { id } = await api("POST", null, { op: "add", collection, data }); return docRef(collection + "/" + id); },
      doc(id) { return docRef(collection + "/" + id); },
      onSnapshot(cb, err) {
        let stop = false, since = null; const store = new Map();
        const emit = () => {
          let rows = [...store.entries()].map(([id, data]) => snap(id, data));
          if (q.orderBy) { const [f, d] = q.orderBy; rows.sort((a, b) => { const x = a.data()[f] ?? "", y = b.data()[f] ?? ""; return (x < y ? -1 : x > y ? 1 : 0) * (d === "desc" ? -1 : 1); }); }
          if (q.limit) rows = rows.slice(0, q.limit);
          cb({ docs: rows, size: rows.length });
        };
        const tick = async () => {
          if (stop) return;
          try {
            let { docs, now } = await api("GET", { collection, limit: Math.max(q.limit || 500, 500), ...(since ? { since } : {}) });
            if (collection === "reads" && !since && !docs.length && !window.__avrSeeded) {
              // Empty database on first open: load the 236 pre-pulled reads from seed/reads.json
              window.__avrSeeded = true;
              try {
                const r = await fetch("/api/seed", { method: "POST", headers: { "x-booth-pass": pass } }); const j = await r.json();
                console.log("seeded reads:", j);
                ({ docs, now } = await api("GET", { collection, limit: Math.max(q.limit || 500, 500) }));
              } catch (e) { console.warn("seed failed", e); }
            }
            if (docs.length || !since) { docs.forEach(d => store.set(d.id, d.data)); if (!stop) emit(); }
            since = now;
          } catch (e) { if (err) err(e); }
          if (!stop) setTimeout(tick, POLL_MS);
        };
        tick();
        return () => { stop = true; };
      }
    };
    return self;
  }

  const db = { collection: collectionRef, doc: docRef };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "download";
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };
  const user = { async can(perm) { if (!pass) askPass(); return !!pass; } };

  window.claude = {
    async use(cap) {
      if (cap === "db") { if (!pass) askPass(); return pass ? db : null; }
      if (cap === "downloads") return downloads;
      if (cap === "user") return user;
      return null; // mcp, sample: not on this host yet
    }
  };
})();
