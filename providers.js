// Data providers. Every external path is configurable through environment variables so a
// wrong endpoint is fixed by changing one value, not the code. All functions return the
// same result shape the UI renders:
// { months, lastMonth, series:{domain:{month:visits}}, engines:{name:visits}, total:{domain:visits},
//   lp:[{url,engine,share}], kw:[{kw,pos,vol,inside}], aio:{inside,total}, status:{key:{state,text}} }

const SW_BASE = process.env.SW_BASE || "https://api.similarweb.com";
const SW_AI_OVERVIEW_PATH = process.env.SW_AI_OVERVIEW_PATH || "/v1/website/{domain}/ai-traffic/overview";
const SW_AI_LANDING_PATH = process.env.SW_AI_LANDING_PATH || "/v1/website/{domain}/ai-traffic/landing-pages";
const SW_VISITS_PATH = process.env.SW_VISITS_PATH || "/v1/website/{domain}/total-traffic-and-engagement/visits";
const SEMRUSH_BASE = process.env.SEMRUSH_BASE || "https://api.semrush.com/";
const AIO = "52"; // Semrush SERP feature code for Google AI Overview

const clean = d => (d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const ym = d => d.toISOString().slice(0, 7);
function monthRange() {
  // Similarweb publishes a month a few weeks after it ends; ask for the last 7 months ending last month
  // and let the API trim to what exists.
  const now = new Date(); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, 1));
  return { start: ym(start), end: ym(end) };
}

async function getJson(url, label) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) { const e = new Error(`${label}: HTTP ${r.status}`); e.status = r.status; e.body = typeof body === "string" ? body.slice(0, 500) : body; throw e; }
  return body;
}

export function swUrl(path, domain, params) {
  const u = new URL(SW_BASE + path.replace("{domain}", encodeURIComponent(domain)));
  Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
  u.searchParams.set("api_key", process.env.SW_API_KEY || "");
  u.searchParams.set("format", "json");
  return u;
}

export async function swAiOverview(domain, country) {
  const { start, end } = monthRange();
  const body = await getJson(swUrl(SW_AI_OVERVIEW_PATH, domain, { country, start_date: start, end_date: end, granularity: "monthly", metrics: "visits" }), "Similarweb AI overview " + domain);
  const rows = body.data || body.ai_traffic || [];
  const byMonth = {}, engines = {};
  rows.forEach(r => { const m = (r.date || "").slice(0, 10); const v = Number(r.visits || 0); byMonth[m] = (byMonth[m] || 0) + v; const e = r.llm_source || r.source || "Other"; engines[e] = (engines[e] || 0) + v; });
  return { months: Object.keys(byMonth).sort(), byMonth, engines, raw: body };
}
export async function swVisits(domain, country, month) {
  const body = await getJson(swUrl(SW_VISITS_PATH, domain, { country, start_date: month, end_date: month, granularity: "monthly", main_domain_only: "false" }), "Similarweb visits " + domain);
  const rows = body.visits || body.data || [];
  return rows.length ? Number(rows[rows.length - 1].visits) : null;
}
export async function swLanding(domain, country, month) {
  const body = await getJson(swUrl(SW_AI_LANDING_PATH, domain, { country, start_date: month, end_date: month, granularity: "monthly", limit: 6, sort: "traffic_share" }), "Similarweb AI landing pages " + domain);
  return (body.data || []).map(r => ({ url: r.url, engine: r.llm_source || r.source || "", share: Number(r.traffic_share) }));
}
export async function semrushAio(domain, database) {
  const u = new URL(SEMRUSH_BASE);
  const p = { type: "domain_organic", key: process.env.SEMRUSH_API_KEY || "", domain, database, display_limit: 30, display_sort: "nq_desc", display_positions_type: "all", export_columns: "Ph,Po,Nq,Tr,Fp,Fk", display_filter: `+|Fk|Co|${AIO}` };
  Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u); const text = await r.text();
  if (!r.ok || /^ERROR/.test(text.trim())) { const e = new Error("Semrush: " + text.trim().slice(0, 200)); e.body = text.slice(0, 500); throw e; }
  const lines = text.trim().split(/\r?\n/); if (lines.length < 2) return { kw: [], raw: text };
  const h = lines[0].split(";");
  const idx = n => h.indexOf(n);
  const kw = lines.slice(1).map(l => { const c = l.split(";"); return { kw: c[idx("Keyword")], pos: Number(c[idx("Position")]), vol: Number(c[idx("Search Volume")]), inside: (c[idx("SERP Features by Position")] || "").split(",").includes(AIO) }; });
  return { kw, raw: text.slice(0, 2000) };
}

export async function runRead({ domain, compA, compB, country = "ww", semdb = "us" }) {
  if (process.env.MOCK === "1") return mockRead({ domain, compA, compB });
  domain = clean(domain); compA = clean(compA); compB = clean(compB);
  const doms = [domain, compA, compB].filter(Boolean);
  const R = { domain, compA, compB, country, months: [], lastMonth: "", series: {}, engines: {}, total: {}, lp: [], kw: [], aio: { inside: 0, total: 0 }, status: {}, errors: [] };
  await Promise.all(doms.map(async d => {
    try { const a = await swAiOverview(d, country); R.series[d] = a.byMonth; if (d === domain) { R.months = a.months; R.engines = a.engines; } if (!R.months.length && a.months.length) R.months = a.months; const last = a.months[a.months.length - 1]; R.status[d] = { state: "ok", text: last ? Math.round(a.byMonth[last]) + " last month" : "no months" }; }
    catch (e) { R.series[d] = {}; R.status[d] = { state: "no", text: "no AI data" }; R.errors.push(e.message); }
  }));
  R.lastMonth = R.months[R.months.length - 1] || "";
  const lm = R.lastMonth ? R.lastMonth.slice(0, 7) : monthRange().end;
  await Promise.all([
    ...doms.map(async d => { try { R.total[d] = await swVisits(d, country, lm); } catch (e) { R.total[d] = null; R.errors.push(e.message); } }),
    (async () => { try { R.lp = await swLanding(domain, country, lm); R.status.pages = { state: "ok", text: R.lp.length + " pages" }; } catch (e) { R.status.pages = { state: "no", text: "none" }; R.errors.push(e.message); } })(),
    (async () => { try { const s = await semrushAio(domain, semdb); R.kw = s.kw; R.aio = { inside: s.kw.filter(k => k.inside).length, total: s.kw.length }; R.status["Google AIO"] = { state: "ok", text: `${R.aio.inside} of ${R.aio.total}` }; } catch (e) { R.status["Google AIO"] = { state: "no", text: "no data" }; R.errors.push(e.message); } })()
  ]);
  return R;
}

export async function diagnostics(domain = "example.com") {
  const out = { mock: process.env.MOCK === "1", keys: { similarweb: !!process.env.SW_API_KEY, semrush: !!process.env.SEMRUSH_API_KEY }, checks: [] };
  const { end } = monthRange();
  const tests = [
    ["Similarweb AI overview", () => swAiOverview(domain, "ww").then(a => ({ months: a.months, sample: a.raw && (a.raw.data || []).slice(0, 2) }))],
    ["Similarweb visits", () => swVisits(domain, "ww", end)],
    ["Similarweb AI landing pages", () => swLanding(domain, "ww", end).then(l => l.slice(0, 3))],
    ["Semrush AI Overview keywords", () => semrushAio(domain, "us").then(s => ({ rows: s.kw.length, sample: s.kw.slice(0, 3), raw: s.raw.slice(0, 300) }))],
  ];
  for (const [name, fn] of tests) {
    try { out.checks.push({ name, ok: true, result: await fn() }); }
    catch (e) { out.checks.push({ name, ok: false, error: e.message, status: e.status, body: e.body }); }
  }
  return out;
}

function mockRead({ domain, compA, compB }) {
  const months = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
  const mk = (base, g) => Object.fromEntries(months.map((m, i) => [m, Math.round(base * Math.pow(g, i))]));
  const d = clean(domain) || "acme.com", a = clean(compA) || "rival.com", b = clean(compB) || "other.com";
  return { domain: d, compA: a, compB: b, country: "ww", months, lastMonth: months[5], series: { [d]: mk(2300, 1.55), [a]: mk(6000, 1.08), [b]: mk(400, 1.2) }, engines: { ChatGPT: 41000, Others: 3000, Claude: 2100, Perplexity: 800 }, total: { [d]: 2900000, [a]: 3100000, [b]: 410000 }, lp: [{ url: d + "/products/guide", engine: "chatgpt", share: 0.2 }, { url: d + "/about", engine: "chatgpt", share: 0.1 }, { url: d + "/faq", engine: "perplexity", share: 0.08 }], kw: [{ kw: "best widgets", pos: 3, vol: 12000, inside: false }, { kw: d.split(".")[0], pos: 1, vol: 9000, inside: true }, { kw: "widget color chart", pos: 8, vol: 4400, inside: false }, { kw: "industrial widgets wholesale", pos: 2, vol: 2900, inside: true }], aio: { inside: 2, total: 4 }, status: { [d]: { state: "ok", text: "mock" }, [a]: { state: "ok", text: "mock" }, [b]: { state: "ok", text: "mock" }, pages: { state: "ok", text: "3 pages" }, "Google AIO": { state: "ok", text: "2 of 4" } }, errors: [], mock: true };
}
