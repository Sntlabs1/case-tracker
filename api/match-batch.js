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
import { scoreTcpaPair } from "../src/lib/matching/tcpaMatchRubric.js";
import { scoreMassTortPair } from "../src/lib/matching/massTortMatchRubric.js";
import { KEYS as TCPA_KEYS } from "../src/lib/ingest/tcpaSchema.js";
import { buildClientReport } from "../src/lib/intelligence/reportBuilder.js";
import { normalize as normalizeDefendant } from "../src/lib/ingest/defendantResolver.js";
import { extractMassTortSignals } from "../src/lib/ingest/creditReportToClient.js";

const REPORT_KEY = (id) => `tcpa:client_report:${id}`;
const REPORT_TTL_DAYS = 7;
const CLIENT_TTL = 365 * 24 * 3600;

const MT_CLIENT_KEY = (id) => `masstort:client_matches:${id}`;
const MT_LEAD_KEY   = (id) => `masstort:lead_matches:${id}`;
const MT_TTL_DAYS = 30;
const MT_MIN_SCORE = 40;
const MT_LEAD_MIN_SCORE = 70;
const MT_TOP_LEADS = 100;

const DEFAULT_THRESHOLD = 50;
const DEFAULT_TOP_N = 50;
const PENDING_CASES_QUEUE   = "tcpa:cases_pending_match";   // list, populated on case ingest
const PENDING_CLIENTS_QUEUE = "tcpa:clients_pending_match"; // sorted set, populated on client import
const OUTREACH_PENDING      = "outreach:pending";           // sorted set, score=match score
const OUTREACH_DISMISSED    = "outreach:dismissed";         // plain set, sticky dismissals

// A match becomes a Pending Outreach candidate when it scores ≥80 and the
// rubric flags qualifies=true. The pair key is `${clientId}|${caseId}`.
const OUTREACH_THRESHOLD = 80;

async function maybeQueueForOutreach(clientId, caseId, scored) {
  if (!scored || scored.score < OUTREACH_THRESHOLD) return;
  if (scored.qualifies !== true) return;
  const member = `${clientId}|${caseId}`;
  // Skip if previously dismissed — operator already passed on it.
  const dismissed = await kv.sismember(OUTREACH_DISMISSED, member).catch(() => 0);
  if (dismissed) return;
  await kv.zadd(OUTREACH_PENDING, { score: scored.score, member }).catch(() => {});
}

async function loadAllClients(max = 5000) {
  const ids = await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []);
  if (ids.length > max) {
    console.warn(`loadAllClients: ${ids.length} clients found but only processing first ${max} — use drainPendingClients for full coverage`);
  }
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

// ── Candidate-set lookup ─────────────────────────────────────────────────────
// Loading every TCPA case for every client recompute is O(clients × allCases)
// — fine up to a few thousand cases, intractable past ~50K clients. The
// inverted indexes maintained at ingest time let us assemble a small candidate
// set per client (typically <500 IDs) so scoring is O(clients × candidates).
//
// Candidate sources (unioned):
//   1. tcpa:cases_by_defendant:${cId} for each canonical creditor in the
//      client's collectionsHistory — the strongest signal.
//   2. tcpa:cases_by_state:${ST}     for the client's state and address-
//      history states — catches state-eligible cases.
//   3. tcpa:cases_by_filing_date     latest N as a baseline so we don't miss
//      nationwide cases the client hasn't directly dealt with the defendant of
//      (they may still qualify on state + class period).
//
// Resolve raw creditor display names to canonicalIds via the alias table when
// the client record was ingested before defendant resolution.
const RECENT_CASES_FALLBACK = 500;
const MAX_CANDIDATES = 2000;

async function resolveCreditorCanonicalIds(client) {
  const out = new Set();
  const pendingLookups = []; // [normalizedName] to alias-lookup
  for (const entry of (client.collectionsHistory || [])) {
    if (entry.creditorCanonicalId) out.add(entry.creditorCanonicalId);
    if (entry.debtBuyerCanonicalId) out.add(entry.debtBuyerCanonicalId);
    if (!entry.creditorCanonicalId && entry.creditor) {
      const norm = normalizeDefendant(entry.creditor);
      if (norm) pendingLookups.push(norm);
    }
    if (!entry.debtBuyerCanonicalId && entry.debtBuyer) {
      const norm = normalizeDefendant(entry.debtBuyer);
      if (norm) pendingLookups.push(norm);
    }
  }
  // Dedup lookups
  const uniqueLookups = [...new Set(pendingLookups)];
  if (uniqueLookups.length) {
    const results = await Promise.all(
      uniqueLookups.map((n) => kv.get(`tcpa:defendant_alias:${n}`).catch(() => null))
    );
    results.forEach((r) => { if (r) out.add(r); });
  }
  return [...out];
}

async function gatherCandidateCaseIds(client) {
  const set = new Set();

  // 1. Defendant-keyed lookups — the load-bearing signal
  const canonicalIds = await resolveCreditorCanonicalIds(client);
  if (canonicalIds.length) {
    const ops = canonicalIds.map((cId) =>
      kv.zrange(TCPA_KEYS.byDefendant(cId), 0, -1, { rev: true }).catch(() => [])
    );
    const results = await Promise.all(ops);
    for (const ids of results) for (const id of ids) set.add(id);
  }

  // 2. State-keyed lookup — current state + any state in addressHistory
  const states = new Set();
  if (client.state) states.add(String(client.state).toUpperCase());
  for (const a of (client.addressHistory || [])) {
    if (a?.state) states.add(String(a.state).toUpperCase());
  }
  if (states.size) {
    const ops = [...states].map((st) =>
      kv.zrange(TCPA_KEYS.byState(st), 0, -1, { rev: true }).catch(() => [])
    );
    const results = await Promise.all(ops);
    // State indexes can be large — cap per state to keep candidate set tractable
    for (const ids of results) {
      for (let i = 0; i < Math.min(ids.length, 1000); i++) set.add(ids[i]);
    }
  }

  // 3. Latest filings — catches nationwide cases that don't surface via
  // defendant or state lookup (e.g., client has no resolved creditors yet).
  // Capped to RECENT_CASES_FALLBACK; tunable for higher recall.
  const recent = await kv
    .zrange(TCPA_KEYS.byFilingDate(), 0, RECENT_CASES_FALLBACK - 1, { rev: true })
    .catch(() => []);
  for (const id of recent) set.add(id);

  // Hard cap to bound memory; very large candidate sets indicate stale state
  // indexes (a defendant with thousands of cases — rare but possible).
  return [...set].slice(0, MAX_CANDIDATES);
}

async function loadCasesByIds(ids) {
  const out = [];
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const records = await Promise.all(slice.map((id) => kv.get(TCPA_KEYS.case(id))));
    records.forEach((r) => {
      if (!r) return;
      out.push(typeof r === "string" ? JSON.parse(r) : r);
    });
  }
  return out;
}

// Load the top N leads by score from `leads_by_score` zset, filtering to
// candidates that are active and above the minimum opportunity score.
async function loadTopLeads(topN = MT_TOP_LEADS) {
  const ids = await kv
    .zrange("leads_by_score", 0, topN - 1, { rev: true })
    .catch(() => []);
  if (!ids.length) return [];

  const raws = await Promise.all(ids.map((id) => kv.get(`lead:${id}`).catch(() => null)));
  const leads = [];
  for (const raw of raws) {
    if (!raw) continue;
    const lead = typeof raw === "string" ? JSON.parse(raw) : raw;
    const analysis = lead.analysis || {};
    if (
      (analysis.opportunityStatus || "").toUpperCase() === "CLOSED" ||
      (analysis.caseStage || "").toLowerCase() === "resolved" ||
      (analysis.targetingReadiness || "").toUpperCase() === "WAIT_FOR_TRIGGER"
    ) continue;
    if ((analysis.score || lead.score || 0) < MT_LEAD_MIN_SCORE) continue;
    leads.push(lead);
  }
  return leads;
}

// Precompute mass-tort matches for one client against the top active leads.
// Writes to:
//   masstort:client_matches:${clientId}   zset, score=matchScore, member=leadId
//   masstort:lead_matches:${leadId}       zset, score=matchScore, member=clientId
// Both keys carry a 7-day TTL so stale data ages out automatically.
export async function recomputeMassTortForClient(client, leads) {
  const clientId = client.id;
  if (!clientId) return { skipped: true, reason: "no client id" };

  const qualifying = [];
  for (const lead of leads) {
    const leadId = lead.id;
    if (!leadId) continue;
    const result = scoreMassTortPair(client, lead);
    if (result.score < MT_MIN_SCORE) continue;
    qualifying.push({ leadId, score: result.score });
  }

  const clientKey = MT_CLIENT_KEY(clientId);
  const ttlSeconds = MT_TTL_DAYS * 24 * 3600;

  // Always clear stale data first — mirrors recomputeClient()'s TCPA pattern.
  await kv.del(clientKey).catch(() => {});

  if (qualifying.length) {
    await kv.zadd(clientKey, ...qualifying.map((q) => ({ score: q.score, member: q.leadId })));
    await kv.expire(clientKey, ttlSeconds).catch(() => {});

    await Promise.all(qualifying.map(({ leadId, score }) =>
      kv.zadd(MT_LEAD_KEY(leadId), { score, member: clientId })
        .then(() => kv.expire(MT_LEAD_KEY(leadId), ttlSeconds))
        .catch(() => {})
    ));
  }

  // Write massTortLastComputedAt back to the client record so the UI can show
  // when mass-tort matching was last run for this client.
  await kv.get(`client:${clientId}`).then((r) => {
    if (!r) return;
    const rec = typeof r === "string" ? JSON.parse(r) : r;
    rec.massTortLastComputedAt = new Date().toISOString();
    return kv.set(`client:${clientId}`, JSON.stringify(rec), { ex: CLIENT_TTL });
  }).catch(() => {});

  return { clientId, massTortPersisted: qualifying.length };
}

export async function recomputeClient(clientId, { threshold, topN, useCandidateSet = false } = {}) {
  const raw = await kv.get(`client:${clientId}`);
  if (!raw) return { error: "client not found" };
  const client = typeof raw === "string" ? JSON.parse(raw) : raw;

  // Backfill massTortSignals for clients ingested before the field existed.
  // Write it back so subsequent recomputes skip this branch.
  if (!client.massTortSignals && client.creditAccounts) {
    client.massTortSignals = extractMassTortSignals(
      client.creditAccounts,
      client.addressHistory || [],
      client.address || null,
      client.creditInquiries || [],
      client.bankruptcies || []
    );
    await kv.set(`client:${clientId}`, JSON.stringify(client), { ex: CLIENT_TTL }).catch(() => {});
  }

  // Snapshot the currently-indexed case members BEFORE recomputing so we can
  // diff and remove stale entries from each dropped case's case_matches index.
  const oldCaseIds = await kv.zrange(`tcpa:client_matches:${clientId}`, 0, -1).catch(() => []);

  // Coverage decision: until the scoring rubric is finalized, score every
  // client × every case so we don't lose visibility into edge cases. Once the
  // formula stabilizes, set useCandidateSet=true to drop to <500 candidates
  // per client via the inverted indexes (gatherCandidateCaseIds below).
  const cases = useCandidateSet
    ? await loadCasesByIds(await gatherCandidateCaseIds(client))
    : await loadAllTcpaCases();

  // Score everything once. Keep the full case object on each row so we can
  // both persist match indexes AND snapshot a report below.
  const allScored = cases
    .map((cs) => ({ caseId: cs.id, case: cs, ...scoreTcpaPair(client, cs) }))
    .sort((a, b) => b.score - a.score);

  const scored = allScored
    .filter((s) => s.score >= threshold)
    .slice(0, topN);

  const key = `tcpa:client_matches:${clientId}`;
  await kv.del(key).catch(() => {});
  if (scored.length) {
    await kv.zadd(key, ...scored.map((s) => ({ score: s.score, member: s.caseId })));
  }

  // Remove this client from any case_matches index that is no longer in the
  // new scored set (stale cross-index cleanup). Batch via Promise.all to avoid
  // N sequential round-trips.
  const newCaseIdSet = new Set(scored.map((s) => s.caseId));
  const droppedCaseIds = oldCaseIds.filter((id) => !newCaseIdSet.has(id));
  if (droppedCaseIds.length) {
    await Promise.all(
      droppedCaseIds.map((caseId) =>
        kv.zrem(`tcpa:case_matches:${caseId}`, clientId).catch(() => {})
      )
    );
  }

  // Fan out into the case-side index.
  await Promise.all(scored.map((s) =>
    kv.zadd(`tcpa:case_matches:${s.caseId}`, { score: s.score, member: clientId })
  ));
  // Enqueue any qualifying ≥80 matches for human-review outreach.
  let outreachQueued = 0;
  for (const s of scored) {
    if (s.score >= OUTREACH_THRESHOLD && s.qualifies) {
      await maybeQueueForOutreach(clientId, s.caseId, s);
      outreachQueued++;
    }
  }

  // Snapshot a printable / CSV-ready report. /api/client-report serves this
  // when fresh (default 24h). Build it from the rules-only scored data — the
  // on-demand path can still call /api/match-cases for Haiku escalation.
  try {
    const matchResult = {
      clientId,
      matches: allScored
        .filter((s) => s.score >= 25 || (s.disqualifyingFactors || []).length > 0)
        .slice(0, 200)
        .map((s) => ({
          id: s.caseId,
          kind: "tcpa",
          case: s.case,
          score: s.score,
          qualifies: s.qualifies,
          matchType: s.matchType,
          confidence: s.confidence,
          confidenceSource: s.confidenceSource,
          matchingFactors: s.matchingFactors,
          disqualifyingFactors: s.disqualifyingFactors,
          reason: summarizeFactors(s),
        })),
      total: cases.length,
    };
    const report = buildClientReport({ client, matchResult });
    await kv.set(REPORT_KEY(clientId), JSON.stringify(report), { ex: REPORT_TTL_DAYS * 24 * 3600 });
  } catch (e) {
    // Don't fail the whole recompute if snapshotting trips
  }

  // ── Mass-tort precompute pass ─────────────────────────────────────────────
  let massTortPersisted = 0;
  try {
    const leads = await loadTopLeads();
    const mtResult = await recomputeMassTortForClient(client, leads);
    massTortPersisted = mtResult.massTortPersisted || 0;
  } catch (e) {
    // Mass-tort pass failure must never break TCPA recompute
  }

  return { clientId, persisted: scored.length, outreachQueued, candidates: cases.length, massTortPersisted };
}

function summarizeFactors(s) {
  if (s.matchType === "disqualified" && s.disqualifyingFactors?.length) return s.disqualifyingFactors[0];
  if (s.matchingFactors?.length) return s.matchingFactors.slice(0, 2).join("; ");
  return "";
}

export async function recomputeCase(caseId, { threshold }) {
  const raw = await kv.get(TCPA_KEYS.case(caseId));
  if (!raw) return { error: "case not found" };
  const caseRecord = typeof raw === "string" ? JSON.parse(raw) : raw;

  // Snapshot the currently-indexed client members BEFORE recomputing so we can
  // diff and remove stale entries from each dropped client's client_matches index.
  const oldClientIds = await kv.zrange(`tcpa:case_matches:${caseId}`, 0, -1).catch(() => []);

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

  // Remove this case from any client_matches index that is no longer in the
  // new scored set (stale cross-index cleanup). Batch via Promise.all to avoid
  // N sequential round-trips.
  const newClientIdSet = new Set(scored.map((s) => s.clientId));
  const droppedClientIds = oldClientIds.filter((id) => !newClientIdSet.has(id));
  if (droppedClientIds.length) {
    await Promise.all(
      droppedClientIds.map((clientId) =>
        kv.zrem(`tcpa:client_matches:${clientId}`, caseId).catch(() => {})
      )
    );
  }

  // Fan out into the client-side index — additive (don't overwrite the client's
  // top-N from other cases, but make sure this case is reflected).
  await Promise.all(scored.map((s) =>
    kv.zadd(`tcpa:client_matches:${s.clientId}`, { score: s.score, member: caseId })
  ));
  // Enqueue any qualifying ≥80 matches for human-review outreach.
  let outreachQueued = 0;
  for (const s of scored) {
    if (s.score >= OUTREACH_THRESHOLD && s.qualifies) {
      await maybeQueueForOutreach(s.clientId, caseId, s);
      outreachQueued++;
    }
  }
  return { caseId, persisted: scored.length, outreachQueued, candidates: clients.length };
}

export async function drainPendingCases({ threshold, max = 50 }) {
  const pending = [];
  for (let i = 0; i < max; i++) {
    const id = await kv.lpop(PENDING_CASES_QUEUE).catch(() => null);
    if (!id) break;
    pending.push(id);
  }
  const results = [];
  for (const caseId of pending) {
    results.push(await recomputeCase(caseId, { threshold }));
  }
  return { drained: pending.length, results };
}

// Drain N clients from the sorted-set queue (oldest first by ingest score).
// Removes each ID only after a successful recompute so a crash mid-run resumes.
export async function drainPendingClients({ threshold, topN, max = 20, useCandidateSet = false }) {
  const ids = await kv.zrange(PENDING_CLIENTS_QUEUE, 0, max - 1).catch(() => []);
  const results = [];
  for (const clientId of ids) {
    const r = await recomputeClient(clientId, { threshold, topN, useCandidateSet });
    if (!r.error) {
      await kv.zrem(PENDING_CLIENTS_QUEUE, clientId).catch(() => {});
    }
    results.push(r);
  }

  // Lightweight prune of outreach:dismissed when it grows too large.
  // OUTREACH_DISMISSED is a plain set — use scard/smembers/srem.
  const dismissedCount = await kv.scard(OUTREACH_DISMISSED).catch(() => 0);
  if (dismissedCount > 2000) {
    const dismissed = await kv.smembers(OUTREACH_DISMISSED).catch(() => []);
    const toCheck = dismissed.slice(0, 500);
    const exists = await Promise.all(
      toCheck.map((pair) => kv.exists(`client:${pair.split("|")[0]}`).catch(() => 1))
    );
    const stale = toCheck.filter((_, j) => !exists[j]);
    if (stale.length > 0) {
      await kv.srem(OUTREACH_DISMISSED, ...stale).catch(() => {});
    }
  }

  return { drained: ids.length, results };
}

async function recomputeAll({ threshold, topN, useCandidateSet = false }) {
  // Compute by iterating clients (each does case fan-out internally).
  const allIds = await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []);
  const clients = await loadAllClients();
  const results = [];
  for (const c of clients) {
    results.push(await recomputeClient(c.id, { threshold, topN, useCandidateSet }));
  }

  // ── Issue 16: prune unbounded sorted sets ───────────────────────────────────
  // Keep outreach:pending bounded to the top 10,000 highest-scoring pairs.
  // zremrangebyrank with 0..-10001 removes everything BELOW the top 10,000.
  await kv.zremrangebyrank(OUTREACH_PENDING, 0, -10001).catch(() => {});

  // Prune outreach:dismissed of entries whose client no longer exists.
  // OUTREACH_DISMISSED is a plain set (sadd/sismember) — use scard/smembers/srem.
  // Only run when the set is large enough to be worth the scan cost.
  const dismissedCount = await kv.scard(OUTREACH_DISMISSED).catch(() => 0);
  if (dismissedCount > 5000) {
    const dismissed = await kv.smembers(OUTREACH_DISMISSED).catch(() => []);
    // Process in batches of 500 to avoid holding too many promises in flight.
    const PRUNE_BATCH = 500;
    for (let i = 0; i < dismissed.length; i += PRUNE_BATCH) {
      const toCheck = dismissed.slice(i, i + PRUNE_BATCH);
      const exists = await Promise.all(
        toCheck.map((pair) => kv.exists(`client:${pair.split("|")[0]}`).catch(() => 1))
      );
      const stale = toCheck.filter((_, j) => !exists[j]);
      if (stale.length > 0) {
        await kv.srem(OUTREACH_DISMISSED, ...stale).catch(() => {});
      }
    }
  }

  return { totalClients: allIds.length, processed: clients.length, totalPersisted: results.reduce((acc, r) => acc + (r.persisted || 0), 0) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { mode, id, max } = req.query;
  const threshold = parseInt(req.body?.threshold ?? DEFAULT_THRESHOLD, 10);
  const topN = parseInt(req.body?.topN ?? DEFAULT_TOP_N, 10);
  // ?candidates=1 opts into the candidate-set fast path; default is full scan
  // so we don't filter any cases out while the scoring rubric is still being
  // tuned. Flip via query string when scaling becomes the priority.
  const useCandidateSet = req.query?.candidates === "1";

  try {
    if (mode === "client") {
      if (!id) return res.status(400).json({ error: "id required for mode=client" });
      const out = await recomputeClient(id, { threshold, topN, useCandidateSet });
      return res.status(out.error ? 404 : 200).json(out);
    }
    if (mode === "case") {
      if (!id) return res.status(400).json({ error: "id required for mode=case" });
      const out = await recomputeCase(id, { threshold });
      return res.status(out.error ? 404 : 200).json(out);
    }
    if (mode === "pending" || mode === "cases_pending") {
      const out = await drainPendingCases({ threshold, max: parseInt(max || "50", 10) });
      return res.status(200).json(out);
    }
    if (mode === "clients_pending") {
      const out = await drainPendingClients({ threshold, topN, max: parseInt(max || "20", 10), useCandidateSet });
      return res.status(200).json(out);
    }
    if (mode === "all") {
      const out = await recomputeAll({ threshold, topN, useCandidateSet });
      return res.status(200).json(out);
    }
    return res.status(400).json({ error: "mode must be client|case|pending|all" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "match-batch failed" });
  }
}
