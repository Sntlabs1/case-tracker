// Vercel serverless — precompute match indexes.
//
// Running 50K-client × 5K-case Haiku scoring on demand is infeasible. Instead,
// we precompute rules-based scores at ingest time (TCPA only — mass-tort still
// goes through /api/match-cases on demand) and persist them to:
//
//   tcpa:client_matches:${clientId}   sorted set, score = match_score, member = caseId
//   tcpa:case_matches:${caseId}       sorted set, score = match_score, member = clientId
//   tcpa:cases_pending_match           queue for newly-ingested cases
//
// POST /api/match-batch?mode=client&id=<clientId>     recompute one client
// POST /api/match-batch?mode=case&id=<caseId>         recompute one case
// POST /api/match-batch?mode=pending&max=<n>          drain the pending-cases queue
// POST /api/match-batch?mode=all                      recompute everything (admin / cron)
//
// Optional body: { threshold: 50 } — minimum score to persist (default 50)

import { kv } from "@vercel/kv";
import { scoreTcpaPair } from "../src/lib/tcpaMatchRubric.js";
import { KEYS as TCPA_KEYS } from "../src/lib/tcpaSchema.js";

const DEFAULT_THRESHOLD = 50;
const DEFAULT_TOP_N = 50;
const PENDING_QUEUE = "tcpa:cases_pending_match";

async function loadAllClients(max = 5000) {
  const ids = await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []);
  const out = [];
  for (let i = 0; i < Math.min(ids.length, max); i += 200) {
    const batch = await Promise.all(ids.slice(i, i + 200).map((id) => kv.get(`client:${id}`)));
    batch.forEach((r) => {
      if (!r) return;
      out.push(typeof r === "string" ? JSON.parse(r) : r);
    });
  }
  return out;
}

async function loadAllTcpaCases(max = 5000) {
  const ids = await kv.zrange(TCPA_KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  const out = [];
  for (let i = 0; i < Math.min(ids.length, max); i += 200) {
    const batch = await Promise.all(ids.slice(i, i + 200).map((id) => kv.get(TCPA_KEYS.case(id))));
    batch.forEach((r) => {
      if (!r) return;
      out.push(typeof r === "string" ? JSON.parse(r) : r);
    });
  }
  return out;
}

async function recomputeClient(clientId, { threshold, topN }) {
  const raw = await kv.get(`client:${clientId}`);
  if (!raw) return { error: "client not found" };
  const client = typeof raw === "string" ? JSON.parse(raw) : raw;
  const cases = await loadAllTcpaCases();
  const scored = cases
    .map((cs) => ({ caseId: cs.id, ...scoreTcpaPair(client, cs) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const key = `tcpa:client_matches:${clientId}`;
  await kv.del(key).catch(() => {});
  if (scored.length) {
    await kv.zadd(key, ...scored.map((s) => ({ score: s.score, member: s.caseId })));
  }
  // Also fan out into the case-side index.
  await Promise.all(scored.map((s) =>
    kv.zadd(`tcpa:case_matches:${s.caseId}`, { score: s.score, member: clientId })
  ));
  return { clientId, persisted: scored.length, candidates: cases.length };
}

async function recomputeCase(caseId, { threshold }) {
  const raw = await kv.get(TCPA_KEYS.case(caseId));
  if (!raw) return { error: "case not found" };
  const caseRecord = typeof raw === "string" ? JSON.parse(raw) : raw;
  const clients = await loadAllClients();
  const scored = clients
    .map((c) => ({ clientId: c.id, ...scoreTcpaPair(c, caseRecord) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const key = `tcpa:case_matches:${caseId}`;
  await kv.del(key).catch(() => {});
  if (scored.length) {
    await kv.zadd(key, ...scored.map((s) => ({ score: s.score, member: s.clientId })));
  }
  // Fan out into the client-side index — additive (don't overwrite the client's
  // top-N from other cases, but make sure this case is reflected).
  await Promise.all(scored.map((s) =>
    kv.zadd(`tcpa:client_matches:${s.clientId}`, { score: s.score, member: caseId })
  ));
  return { caseId, persisted: scored.length, candidates: clients.length };
}

async function drainPending({ threshold, max = 50 }) {
  const pending = [];
  for (let i = 0; i < max; i++) {
    const id = await kv.lpop(PENDING_QUEUE).catch(() => null);
    if (!id) break;
    pending.push(id);
  }
  const results = [];
  for (const caseId of pending) {
    results.push(await recomputeCase(caseId, { threshold }));
  }
  return { drained: pending.length, results };
}

async function recomputeAll({ threshold, topN }) {
  // Compute by iterating clients (each does case fan-out internally).
  const clients = await loadAllClients();
  const results = [];
  for (const c of clients) {
    results.push(await recomputeClient(c.id, { threshold, topN }));
  }
  return { clients: clients.length, totalPersisted: results.reduce((acc, r) => acc + (r.persisted || 0), 0) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { mode, id, max } = req.query;
  const threshold = parseInt(req.body?.threshold ?? DEFAULT_THRESHOLD);
  const topN = parseInt(req.body?.topN ?? DEFAULT_TOP_N);

  try {
    if (mode === "client") {
      if (!id) return res.status(400).json({ error: "id required for mode=client" });
      const out = await recomputeClient(id, { threshold, topN });
      return res.status(out.error ? 404 : 200).json(out);
    }
    if (mode === "case") {
      if (!id) return res.status(400).json({ error: "id required for mode=case" });
      const out = await recomputeCase(id, { threshold });
      return res.status(out.error ? 404 : 200).json(out);
    }
    if (mode === "pending") {
      const out = await drainPending({ threshold, max: parseInt(max || "50") });
      return res.status(200).json(out);
    }
    if (mode === "all") {
      const out = await recomputeAll({ threshold, topN });
      return res.status(200).json(out);
    }
    return res.status(400).json({ error: "mode must be client|case|pending|all" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "match-batch failed" });
  }
}
