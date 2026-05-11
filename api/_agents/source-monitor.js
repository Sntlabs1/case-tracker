// Source-monitor agent — probes every external data source the platform
// depends on, classifies health (green/yellow/red), and tracks per-source
// last-success / last-failure timestamps. Runs hourly.
//
// Output → `agent:source-monitor:rollup` (read by the Sources tab + Agents UI)
// Per-source history → `agent:source-monitor:history:${id}` (lpush, ltrim 30)

import { kv } from "@vercel/kv";
import { SOURCES } from "../../src/lib/sourceRegistry.js";

const ROLLUP_KEY = "agent:source-monitor:rollup";
const PROBE_TIMEOUT_MS = 12_000;
const PARALLEL = 8;

// Sources missing required auth env vars get probed but flagged "skipped",
// not failed — we don't want to drown the dashboard in red dots for paid
// integrations that just haven't been provisioned yet.
function authMissing(s) {
  return s.auth && !process.env[s.auth];
}

function applyAuth(s, headers) {
  if (!s.auth || authMissing(s)) return;
  const token = process.env[s.auth];
  switch (s.authStyle) {
    case "bearer":      headers.Authorization = `Bearer ${token}`; break;
    case "token":       headers.Authorization = `Token ${token}`;  break;
    case "x-api-key":   headers["x-api-key"] = token;              break;
    case "x-app-token": headers["X-App-Token"] = token;            break;
    case "query-key":   /* applied to URL by caller */             break;
    default:            headers.Authorization = `Bearer ${token}`;
  }
}

function buildUrl(s) {
  if (s.authStyle !== "query-key" || authMissing(s)) return s.url;
  const u = new URL(s.url);
  u.searchParams.set("key", process.env[s.auth]);
  return u.toString();
}

async function probeOne(s) {
  // Sources we KNOW are dead (URL drift); skip the network round-trip and
  // surface as a distinct "broken" state so the UI shows "needs URL fix".
  if (s.broken) {
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      kind: s.kind,
      health: "broken",
      reason: "URL needs update — feed has moved or been removed",
      probedAt: new Date().toISOString(),
    };
  }
  if (authMissing(s)) {
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      kind: s.kind,
      health: "skipped",
      reason: `${s.auth} not set`,
      probedAt: new Date().toISOString(),
    };
  }

  const headers = { "User-Agent": s.ua || "ToroBot/1.0 (+source-monitor)" };
  applyAuth(s, headers);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();

  let status = 0;
  let bodyLen = 0;
  let networkErr = null;
  let validationErr = null;

  try {
    const res = await fetch(buildUrl(s), { method: "GET", headers, signal: ctrl.signal });
    status = res.status;
    // Read just enough to validate, not the whole feed.
    const text = (await res.text()).slice(0, 4096);
    bodyLen = text.length;

    if (status >= 200 && status < 300) {
      if (s.kind === "rss") {
        if (!/<(rss|feed|atom|channel|item|entry)\b/i.test(text)) {
          validationErr = "no RSS/Atom markers in body";
        }
      } else if (s.kind === "rest") {
        const trimmed = text.trim();
        if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
          validationErr = "non-JSON response";
        }
      }
    }
  } catch (e) {
    networkErr = e.name === "AbortError" ? "timeout" : (e.message || String(e));
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - t0;
  let health;
  if (networkErr)            health = "red";
  else if (status >= 500)    health = "red";
  else if (status === 401 || status === 403) health = "red";
  else if (status >= 400)    health = "yellow";  // many APIs return 400 on missing params; the URL is reachable
  else if (validationErr)    health = "yellow";
  else                       health = "green";

  return {
    id: s.id,
    name: s.name,
    category: s.category,
    kind: s.kind,
    health,
    httpStatus: status,
    latencyMs,
    bodyLen,
    error: networkErr || validationErr || null,
    probedAt: new Date().toISOString(),
  };
}

// Limited concurrency runner so we don't spike all 35 endpoints at once.
async function runWithConcurrency(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Cross-reference probe results with our ingest pipeline's last-success
// timestamps so we know not just "is the URL reachable" but also "did our
// pipeline actually fetch new data recently".
async function attachIngestStatus(probes) {
  const now = Date.now();
  return Promise.all(probes.map(async (p) => {
    const src = SOURCES.find((s) => s.id === p.id);
    if (!src?.ingestKey) return p;
    const stats = await kv.get(`${src.ingestKey}:stats`).catch(() => null);
    if (!stats) return p;
    const parsed = typeof stats === "string" ? JSON.parse(stats) : stats;
    const lastIngestAt = parsed?.ranAt || null;
    const ageHours = lastIngestAt
      ? Math.round((now - new Date(lastIngestAt).getTime()) / 3_600_000)
      : null;
    return { ...p, lastIngestAt, ingestAgeHours: ageHours };
  }));
}

export default {
  name: "source-monitor",
  description: "Probes every external data source (RSS, REST, news APIs) for reachability and validates response shape. Cross-references against our ingest pipeline's last-success timestamps so 'reachable but stale' is distinct from 'down'.",
  schedule: "0 * * * *", // hourly

  async run() {
    const startedAt = Date.now();

    let probes = await runWithConcurrency(SOURCES, PARALLEL, probeOne);
    probes = await attachIngestStatus(probes);

    // Bucket counts for the headline summary.
    const byHealth = { green: 0, yellow: 0, red: 0, skipped: 0, broken: 0 };
    for (const p of probes) byHealth[p.health] = (byHealth[p.health] || 0) + 1;

    // Per-category rollup.
    const byCategory = {};
    for (const p of probes) {
      if (!byCategory[p.category]) byCategory[p.category] = { green: 0, yellow: 0, red: 0, skipped: 0, broken: 0, total: 0 };
      byCategory[p.category][p.health]++;
      byCategory[p.category].total++;
    }

    // Persist per-source history (last 30 probes).
    await Promise.all(probes.map(async (p) => {
      const histKey = `agent:source-monitor:history:${p.id}`;
      const compact = {
        probedAt: p.probedAt,
        health: p.health,
        httpStatus: p.httpStatus,
        latencyMs: p.latencyMs,
        error: p.error,
      };
      await kv.lpush(histKey, JSON.stringify(compact)).catch(() => {});
      await kv.ltrim(histKey, 0, 29).catch(() => {});
    }));

    const rollup = {
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      total: probes.length,
      byHealth,
      byCategory,
      sources: probes,
    };

    await kv.set(ROLLUP_KEY, JSON.stringify(rollup), { ex: 7 * 24 * 3600 });

    return {
      ok: true,
      summary: {
        total: probes.length,
        green: byHealth.green,
        yellow: byHealth.yellow,
        red: byHealth.red,
        broken: byHealth.broken,
        skipped: byHealth.skipped,
      },
      result: rollup,
    };
  },
};
