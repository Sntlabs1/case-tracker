// Agents orchestrator.
//
// GET /api/agents                       — list registered agents + last-run status (for the Agents tab)
// GET /api/agents?run=<name>            — manually trigger an agent (also used by Vercel cron)
// GET /api/agents?status=<name>         — single-agent status + run history
// GET /api/agents?rollup=<name>         — convenience read of an agent's output blob (e.g. freshness)
//
// Agents are modules in api/_agents/ exporting a default object:
//   { name, description, schedule, async run() { return { ok, summary, result } } }

import { kv } from "@vercel/kv";

import freshness from "./_agents/freshness.js";
import sourceMonitor from "./_agents/source-monitor.js";
import tcpaBackfill from "./_agents/tcpa-backfill.js";
import matchRecompute from "./_agents/match-recompute.js";
import caseTracker from "./_agents/case-tracker.js";
import plaintiffBackfill from "./_agents/plaintiff-backfill.js";
import settlementEnrichment from "./_agents/settlement-enrichment.js";
import classDefinitionExtractor from "./_agents/class-definition-extractor.js";

// Static registry — explicit imports keep cold-start predictable.
const REGISTRY = [
  freshness,
  sourceMonitor,
  tcpaBackfill,
  matchRecompute,
  caseTracker,
  plaintiffBackfill,
  settlementEnrichment,
  classDefinitionExtractor,
];

const HISTORY_LEN = 50;
const LOCK_TTL = 600; // seconds — guards against concurrent runs

const statusKey = (name) => `agent:${name}:status`;
const historyKey = (name) => `agent:${name}:history`;
const lockKey = (name) => `agent:${name}:lock`;
const rollupKey = (name) => `agent:${name}:rollup`;

function find(name) {
  return REGISTRY.find((a) => a.name === name);
}

async function readJson(key) {
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function readList(key, max = HISTORY_LEN) {
  const items = await kv.lrange(key, 0, max - 1).catch(() => []);
  return items.map((x) => (typeof x === "string" ? JSON.parse(x) : x));
}

async function runAgent(agent, runOpts = {}) {
  // Concurrency guard — first writer wins. NX option on @vercel/kv via { nx: true }.
  const acquired = await kv.set(lockKey(agent.name), Date.now(), { ex: LOCK_TTL, nx: true }).catch(() => null);
  if (acquired === null || acquired === false) {
    return { ok: false, reason: "locked" };
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let result, runErr = null;
  try {
    result = await agent.run(runOpts);
  } catch (e) {
    runErr = e;
  }

  const durationMs = Date.now() - t0;
  const status = {
    name: agent.name,
    schedule: agent.schedule,
    description: agent.description,
    ranAt: startedAt,
    durationMs,
    ok: !runErr && (result?.ok !== false),
    error: runErr ? String(runErr.message || runErr) : (result?.error || null),
    summary: result?.summary || null,
  };

  // Best-effort persistence — never let KV writes throw out of the orchestrator.
  await Promise.all([
    kv.set(statusKey(agent.name), JSON.stringify(status), { ex: 30 * 24 * 3600 }).catch(() => {}),
    kv.lpush(historyKey(agent.name), JSON.stringify(status)).catch(() => {}),
    kv.ltrim(historyKey(agent.name), 0, HISTORY_LEN - 1).catch(() => {}),
    kv.del(lockKey(agent.name)).catch(() => {}),
  ]);

  if (runErr) {
    return { ok: false, error: status.error, durationMs };
  }
  return { ok: true, summary: result?.summary || null, durationMs };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { run, status: statusName, rollup, unlock } = req.query || {};

  // ── Admin: clear a stale lock ────────────────────────────────────────────
  // After a killed run, the lock key can persist until TTL (10 min). This
  // lets the operator force-release without waiting.
  if (unlock) {
    const agent = find(unlock);
    if (!agent) return res.status(404).json({ error: `unknown agent '${unlock}'` });
    await kv.del(lockKey(unlock)).catch(() => {});
    return res.status(200).json({ ok: true, unlocked: unlock });
  }

  // ── Manual / cron-triggered run ─────────────────────────────────────────
  if (run) {
    const agent = find(run);
    if (!agent) return res.status(404).json({ error: `unknown agent '${run}'` });
    // Pass through any numeric query params as run options. Agents that
    // accept `max`, `threshold`, etc. get them automatically.
    const runOpts = {};
    for (const k of ["max", "threshold", "topN", "limit", "batchSize"]) {
      if (req.query?.[k] !== undefined) {
        const n = parseInt(req.query[k]);
        if (!isNaN(n)) runOpts[k] = n;
      }
    }
    const result = await runAgent(agent, runOpts);
    if (!result.ok && result.reason === "locked") {
      return res.status(409).json({ ok: false, reason: "locked" });
    }
    return res.status(result.ok ? 200 : 500).json(result);
  }

  // ── Single-agent status + history ───────────────────────────────────────
  if (statusName) {
    const agent = find(statusName);
    if (!agent) return res.status(404).json({ error: `unknown agent '${statusName}'` });
    const [status, history] = await Promise.all([
      readJson(statusKey(statusName)),
      readList(historyKey(statusName)),
    ]);
    return res.status(200).json({
      agent: {
        name: agent.name,
        description: agent.description,
        schedule: agent.schedule,
      },
      status,
      history,
    });
  }

  // ── Rollup read (e.g. ?rollup=freshness) ────────────────────────────────
  if (rollup) {
    const data = await readJson(rollupKey(rollup));
    if (!data) return res.status(200).json({ rollup: null });
    return res.status(200).json({ rollup: data });
  }

  // ── List all agents with their last-run status ──────────────────────────
  const agents = await Promise.all(REGISTRY.map(async (a) => {
    const status = await readJson(statusKey(a.name));
    return {
      name: a.name,
      description: a.description,
      schedule: a.schedule,
      lastStatus: status,
    };
  }));
  return res.status(200).json({ agents });
}
