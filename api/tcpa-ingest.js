// TCPA / FDCPA / FCRA case ingest orchestrator.
//
// GET /api/tcpa-ingest?source=<src>&mode=<mode>&caseType=<type>
//   source:   courtlistener | tcpaworld | classaction | unicourt | trellis | fcc | all
//   mode:     daily (default) | backfill
//   caseType: TCPA | FDCPA | FCRA | all (default: all)
//
// Returns { runs: [...] } — one entry per source attempted, with per-source
// stats. Errors in one source do not abort others.
//
// Triggered by:
//   - vercel cron (vercel.json) once daily, source=all&mode=daily
//   - manual one-shot backfill via curl after deploy
//
// Auth env vars (set in .env.local for dev, Vercel project for prod):
//   COURTLISTENER_API_TOKEN  (free at courtlistener.com)
//   ANTHROPIC_API_KEY        (already present — used by RSS extractors)
//   UNICOURT_API_KEY         (paid)
//   TRELLIS_API_KEY          (paid)
//   FCC_APP_TOKEN            (optional; raises Socrata rate limit)

import { kv } from "@vercel/kv";
import { importCases } from "../src/lib/tcpaCaseStore.js";
import { runCourtListener }  from "./_tcpa-sources/courtlistener.js";
import { runTcpaWorld }      from "./_tcpa-sources/tcpaworld.js";
import { runClassActionRss } from "./_tcpa-sources/classaction-rss.js";
import { runUniCourt }       from "./_tcpa-sources/unicourt.js";
import { runTrellis }        from "./_tcpa-sources/trellis.js";
import { runFccComplaints }  from "./_tcpa-sources/fcc-complaints.js";
import { runWestlawCsv }     from "./_tcpa-sources/westlaw-csv.js";

// westlaw-csv reads local files only — left out of "all" so the daily cron
// doesn't pointlessly scan an empty filesystem in production.
const ALL_SOURCES = ["courtlistener", "tcpaworld", "classaction", "unicourt", "trellis", "fcc"];

const RUNNERS = {
  courtlistener: runCourtListener,
  tcpaworld:     runTcpaWorld,
  classaction:   runClassActionRss,
  unicourt:      runUniCourt,
  trellis:       runTrellis,
  fcc:           runFccComplaints,
  "westlaw-csv": runWestlawCsv,
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).end();

  // ── Stats-only read: surface last-run health per source for the UI. ──────
  if (req.query?.stats) {
    const keys = ALL_SOURCES.map((s) => `tcpa:ingest:${s}:stats`);
    const raw = await Promise.all(keys.map((k) => kv.get(k).catch(() => null)));
    const stats = {};
    ALL_SOURCES.forEach((s, i) => {
      const v = raw[i];
      stats[s] = v ? (typeof v === "string" ? JSON.parse(v) : v) : null;
    });
    return res.status(200).json({ stats });
  }

  const {
    source = "all",
    mode = "daily",
    caseType = "all",
    since,    // optional override (YYYY-MM-DD) — bypasses per-source cursor for this run
  } = req.query || {};

  if (!["daily", "backfill"].includes(mode)) {
    return res.status(400).json({ error: `invalid mode '${mode}'` });
  }

  const sources = source === "all"
    ? ALL_SOURCES
    : source.split(",").map((s) => s.trim()).filter(Boolean);

  for (const s of sources) {
    if (!RUNNERS[s]) {
      return res.status(400).json({ error: `unknown source '${s}'` });
    }
  }

  const caseTypes = caseType === "all"
    ? ["TCPA", "FDCPA", "FCRA"]
    : caseType.split(",").map((c) => c.trim()).filter(Boolean);

  const runs = [];

  for (const s of sources) {
    const runner = RUNNERS[s];
    try {
      const result = await runner({
        mode,
        caseTypes,
        since: since || null,
        importer: importCases,
      });
      runs.push(result);
    } catch (err) {
      runs.push({
        source: s,
        mode,
        error: err.message,
      });
    }
  }

  const totals = runs.reduce((acc, r) => {
    acc.created   += r.created   || 0;
    acc.updated   += r.updated   || 0;
    acc.unchanged += r.unchanged || 0;
    acc.errors    += r.errors    || 0;
    return acc;
  }, { created: 0, updated: 0, unchanged: 0, errors: 0 });

  return res.status(200).json({
    ok: true,
    sources,
    mode,
    caseTypes,
    totals,
    runs,
  });
}
