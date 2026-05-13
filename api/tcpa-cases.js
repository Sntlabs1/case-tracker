// Vercel serverless — TCPA / FDCPA / FCRA case database CRUD.
//
// GET    /api/tcpa-cases                              — list (filters: ?defendant=&state=&status=&q=&limit=)
// GET    /api/tcpa-cases?id=<id>                      — single record
// POST   /api/tcpa-cases  body: { cases: [...] }      — bulk import
// POST   /api/tcpa-cases  body: { case:  {...} }      — single import
// PATCH  /api/tcpa-cases  body: { id, status?, settlement?, lastVerifiedAt? }  — partial update
// DELETE /api/tcpa-cases?id=<id>                      — remove
//
// Records pass through tcpaSchema.buildCase() for validation. Defendants on each
// case are resolved to canonical IDs via defendantResolver — unknown names are
// auto-created (Phase 1 cold start has zero defendants; ambiguity gating moves
// to api/resolve-defendant.js once we have a population to disambiguate against).

import { kv } from "@vercel/kv";
import {
  KEYS,
  CASE_STATUSES,
  epochOrZero,
} from "../src/lib/tcpaSchema.js";
import {
  resolveOrSuggest,
} from "../src/lib/defendantResolver.js";
import { importCases, unindexCase } from "../src/lib/tcpaCaseStore.js";

const CACHE_TTL = 300;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── PATCH — partial update ────────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { id, status, settlement, lastVerifiedAt, classDefinition, conductDescription } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });
    const raw = await kv.get(KEYS.case(id));
    if (!raw) return res.status(404).json({ error: "TCPA case not found" });
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;

    const prevStatus = record.status;
    const updated = {
      ...record,
      status:             status ?? record.status,
      settlement:         settlement ? { ...record.settlement, ...settlement } : record.settlement,
      lastVerifiedAt:     lastVerifiedAt ?? new Date().toISOString(),
      classDefinition:    classDefinition ?? record.classDefinition,
      conductDescription: conductDescription ?? record.conductDescription,
    };

    if (status && !CASE_STATUSES.includes(status)) {
      return res.status(400).json({ error: `invalid status '${status}'` });
    }

    const ops = [
      kv.set(KEYS.case(id), JSON.stringify(updated), { ex: 365 * 24 * 3600 }),
    ];
    if (status && status !== prevStatus) {
      ops.push(kv.zrem(KEYS.byStatus(prevStatus), id));
      ops.push(kv.zadd(KEYS.byStatus(status), { score: Date.now(), member: id }));
    }
    if (settlement?.finalApprovalDate) {
      ops.push(kv.zadd(KEYS.bySettlementDate(), {
        score: epochOrZero(settlement.finalApprovalDate),
        member: id,
      }));
    }
    await Promise.all(ops);
    await kv.del(KEYS.cacheFull()).catch(() => {});
    return res.status(200).json({ updated: id, status: updated.status });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    const raw = await kv.get(KEYS.case(id));
    if (!raw) return res.status(404).json({ error: "TCPA case not found" });
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    await unindexCase(record);
    await kv.del(KEYS.cacheFull()).catch(() => {});
    return res.status(200).json({ deleted: id });
  }

  // ── POST — bulk import ────────────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body || {};
    const incoming = body.cases || (body.case ? [body.case] : []);
    if (!incoming.length) return res.status(400).json({ error: "cases array required" });

    const result = await importCases(incoming);
    return res.status(200).json({
      imported: result.created + result.updated,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      ids: [...result.ids.created, ...result.ids.updated],
      errors: result.errors,
    });
  }

  // ── GET — single or list ──────────────────────────────────────────────────
  if (req.method !== "GET") return res.status(405).end();

  const { id, defendant, state, status, q, limit = "1000" } = req.query;
  const lim = Math.min(parseInt(limit), 5000);

  // Single record fetch (optionally with ?history=1 for case-tracker events)
  if (id) {
    const raw = await kv.get(KEYS.case(id));
    if (!raw) return res.status(404).json({ error: "TCPA case not found" });
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (req.query.history) {
      const items = await kv.lrange(`tcpa:case_history:${id}`, 0, 49).catch(() => []);
      const history = items.map((x) => (typeof x === "string" ? JSON.parse(x) : x));
      return res.status(200).json({ case: record, history });
    }
    return res.status(200).json({ case: record });
  }

  // Cache hit only for the unfiltered default fetch
  const isDefault = !defendant && !state && !status && !q && lim >= 1000;
  if (isDefault) {
    try {
      const cached = await kv.get(KEYS.cacheFull());
      if (cached) {
        const data = typeof cached === "string" ? JSON.parse(cached) : cached;
        return res.status(200).json({ ...data, cached: true });
      }
    } catch {}
  }

  // Pick the best inverted index for the query
  let candidateIds = [];
  if (defendant) {
    // Caller may pass either a canonicalId or a raw name. Resolve raw names to canonical first.
    let cId = defendant;
    if (!defendant.startsWith("def_")) {
      const sug = await resolveOrSuggest(defendant);
      cId = sug.canonicalId;
    }
    candidateIds = cId ? await kv.zrange(KEYS.byDefendant(cId), 0, -1, { rev: true }).catch(() => []) : [];
  } else if (state) {
    candidateIds = await kv.zrange(KEYS.byState(state.toUpperCase()), 0, -1, { rev: true }).catch(() => []);
  } else if (status) {
    candidateIds = await kv.zrange(KEYS.byStatus(status), 0, -1, { rev: true }).catch(() => []);
  } else {
    candidateIds = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  }

  if (!candidateIds.length) return res.status(200).json({ cases: [], total: 0 });

  // Batch-fetch records
  const BATCH = 100;
  const records = [];
  for (let i = 0; i < candidateIds.length; i += BATCH) {
    const batch = await Promise.all(
      candidateIds.slice(i, i + BATCH).map((cid) => kv.get(KEYS.case(cid)))
    );
    batch.forEach((r) => {
      if (!r) return;
      const c = typeof r === "string" ? JSON.parse(r) : r;
      // Apply secondary filters
      if (state && c.court?.state !== state.toUpperCase() && !(c.eligibleStates || []).includes(state.toUpperCase())) return;
      if (status && c.status !== status) return;
      if (q) {
        const ql = q.toLowerCase();
        const haystack = `${c.caption} ${(c.defendants || []).map(d => d.displayName).join(" ")} ${c.conductDescription} ${c.classDefinition}`.toLowerCase();
        if (!haystack.includes(ql)) return;
      }
      records.push(c);
    });
    if (records.length >= lim) break;
  }

  const payload = {
    cases: records.slice(0, lim),
    total: candidateIds.length,
    filtered: records.length,
  };
  if (isDefault) {
    await kv.set(KEYS.cacheFull(), JSON.stringify(payload), { ex: CACHE_TTL }).catch(() => {});
  }
  return res.status(200).json(payload);
}
