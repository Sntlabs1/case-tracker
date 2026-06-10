// GET /api/build-case-index
// In-region resumable sweep that runs EVERY person in the credit DB against
// EVERY case (defendant) in our catalog, and writes a per-case inverted index
// so each case can show its complete matched population instantly.
//
// For each `client:*` record it inspects `cases[].defendant` and, for every
// catalog defendant token that the signal names, adds the person to
//   casepeople:<defendantToken>   (zset, score = priorityScore)
// Each per-case zset is capped to the top CAP people by priority score, so a
// very common furnisher (Capital One, Citibank…) can't exceed Upstash's 100MB
// per-key limit. Every person is still evaluated against every case; we retain
// the highest-priority matches per case (far more than any worklist needs).
//
// Catalog = the 41 PACER FDCPA/FCRA clusters (match:defendant_evidence) plus
// the national TCPA marketer defendants (pacer:tcpa_marketers).
//
// Resumable via `caseindex:stats.cursor`; idempotent (ZADD). Driven by cron
// until the SCAN cursor returns to 0, then refreshes at most once per REFRESH_MS.

import { kv } from "@vercel/kv";
import { canonicalToken } from "./_lib/defendantToken.js";

const TIME_BUDGET_MS = 230_000;   // stop well before the 300s function limit
const SCAN_COUNT     = 1000;      // Upstash caps returned keys at ~1000/call
const TRIM_EVERY     = 25;        // trim touched zsets every N batches, not each
const REFRESH_MS     = 12 * 60 * 60 * 1000;
const CAP            = 200_000;   // max people retained per case (zset size guard)

async function loadCatalogTokens() {
  const [evRaw, tcpaRaw] = await Promise.all([
    kv.get("match:defendant_evidence"),
    kv.get("pacer:tcpa_marketers"),
  ]);
  const ev   = evRaw ? (typeof evRaw === "string" ? JSON.parse(evRaw) : evRaw) : {};
  const tcpa = tcpaRaw ? (typeof tcpaRaw === "string" ? JSON.parse(tcpaRaw) : tcpaRaw) : {};

  const tokens = new Set();
  for (const name of Object.keys(ev.clusters || {})) {
    const t = canonicalToken(name);
    if (t) tokens.add(t);
  }
  for (const d of (tcpa.defendants || [])) {
    const t = canonicalToken(d.defendant || d.defendantQ || "");
    if (t) tokens.add(t);
  }
  return [...tokens];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const stats = (await kv.get("caseindex:stats")) || {};
    const now = Date.now();

    // If a previous full sweep completed recently, no-op (let cron rest).
    if (stats.done && stats.completedAt && (now - stats.completedAt) < REFRESH_MS && !req.query.force) {
      return res.status(200).json({ status: "idle", message: "Index fresh; nothing to do.", stats });
    }

    const tokens = await loadCatalogTokens();
    if (tokens.length === 0) {
      return res.status(200).json({ status: "no_catalog", message: "No catalog defendants loaded." });
    }
    const tokenSet = new Set(tokens);

    // Resume point. A fresh start (or a forced refresh) begins at cursor 0.
    let cursor = stats.done || req.query.force ? "0" : (stats.cursor || "0");
    let scanned = stats.done || req.query.force ? 0 : (stats.scanned || 0);
    let indexed = stats.done || req.query.force ? 0 : (stats.indexed || 0);
    const startedAt = stats.done || req.query.force ? now : (stats.startedAt || now);

    const start = Date.now();
    let completed = false;
    let batchCount = 0;
    const touched = new Set();   // tokens needing a trim

    // Trim touched zsets back to the top CAP. Done periodically (not every
    // batch) — that per-batch trimming was the throughput bottleneck. Between
    // trims a hot token overshoots CAP by at most ~TRIM_EVERY*1000 members
    // (~tens of MB), still far under the 100MB key limit.
    const flushTrim = async () => {
      if (touched.size === 0) return;
      const toks = [...touched];
      touched.clear();
      await Promise.all(toks.map(tok => kv.zremrangebyrank(`casepeople:${tok}`, 0, -(CAP + 1))));
    };

    while (Date.now() - start < TIME_BUDGET_MS) {
      const [next, keys] = await kv.scan(cursor, { match: "client:*", count: SCAN_COUNT });
      cursor = next;

      if (keys && keys.length) {
        const records = await kv.mget(...keys);
        const byToken = new Map();   // token -> [{ score, member }]

        for (const r of records) {
          if (!r) continue;
          const c = typeof r === "string" ? JSON.parse(r) : r;
          scanned++;
          const id = c.id;
          if (!id) continue;
          const score = Number(c.priorityScore) || 0;
          const cases = c.cases || [];
          if (!cases.length) continue;

          // New records carry a canonical sig.defendantToken; fall back to
          // computing it for any legacy record. Exact set membership — no more
          // substring false-positives or normalizer drift.
          const hit = new Set();
          for (const sig of cases) {
            const tok = sig.defendantToken || canonicalToken(sig.defendant || "");
            if (tok && tokenSet.has(tok)) hit.add(tok);
          }
          for (const tok of hit) {
            if (!byToken.has(tok)) byToken.set(tok, []);
            byToken.get(tok).push({ score, member: id });
            indexed++;
          }
        }

        // Add this batch's members; defer trimming.
        const writes = [];
        for (const [tok, members] of byToken) {
          writes.push(kv.zadd(`casepeople:${tok}`, ...members));
          touched.add(tok);
        }
        await Promise.all(writes);

        if (++batchCount % TRIM_EVERY === 0) await flushTrim();
      }

      if (cursor === "0") { completed = true; break; }
    }

    await flushTrim();   // settle zset sizes before returning

    const out = {
      startedAt,
      lastRunAt:   now,
      cursor,
      scanned,
      indexed,
      tokensCount: tokens.length,
      done:        completed,
      completedAt: completed ? Date.now() : (stats.completedAt || null),
    };
    await kv.set("caseindex:stats", out);

    return res.status(200).json({
      status: completed ? "complete" : "in_progress",
      stats:  out,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
