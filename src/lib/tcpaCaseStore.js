// Shared write path for the TCPA/FDCPA/FCRA case database.
//
// Used by:
//   - api/tcpa-cases.js  (manual / one-off bulk imports)
//   - api/tcpa-ingest.js (automated ingest from CourtListener, UniCourt, etc.)
//
// Idempotency: callers that pass a deterministic `id` (e.g. `cl_${docketId}`,
// `uc_${caseId}`) get upsert semantics. Re-running a source over the same
// window updates existing records instead of duplicating them.

import { kv } from "@vercel/kv";
import { buildCase, KEYS, CASE_STATUSES, epochOrZero } from "./tcpaSchema.js";
import { resolveOrSuggest, createDefendant } from "./defendantResolver.js";

export async function resolveDefendantsForCase(rawDefendants = []) {
  const resolved = [];
  for (const d of rawDefendants) {
    const displayName = typeof d === "string" ? d : (d?.displayName || d?.name);
    if (!displayName) continue;
    const role = typeof d === "string" ? "primary" : (d?.role || "primary");
    // Bulk importers pre-resolve canonical IDs to avoid the O(N) per-row
    // trigram fallback in findCandidates(). Respect a pre-attached canonicalId.
    if (typeof d === "object" && d?.canonicalId) {
      resolved.push({ canonicalId: d.canonicalId, displayName, role });
      continue;
    }
    const sug = await resolveOrSuggest(displayName);
    let canonicalId = sug.canonicalId;
    if (!canonicalId) {
      const newDef = await createDefendant({ displayName });
      canonicalId = newDef.canonicalId;
    }
    resolved.push({ canonicalId, displayName, role });
  }
  return resolved;
}

export async function indexCase(record) {
  const ops = [
    kv.set(KEYS.case(record.id), JSON.stringify(record), { ex: 365 * 24 * 3600 }),
    kv.zadd(KEYS.byFilingDate(), { score: epochOrZero(record.filingDate), member: record.id }),
    kv.zadd(KEYS.byStatus(record.status), { score: Date.now(), member: record.id }),
  ];
  if (record.settlement?.finalApprovalDate) {
    ops.push(kv.zadd(KEYS.bySettlementDate(), {
      score: epochOrZero(record.settlement.finalApprovalDate),
      member: record.id,
    }));
  }
  if (record.court?.state) {
    ops.push(kv.zadd(KEYS.byState(record.court.state), { score: epochOrZero(record.filingDate), member: record.id }));
  }
  for (const st of (record.eligibleStates || [])) {
    ops.push(kv.zadd(KEYS.byState(st), { score: epochOrZero(record.filingDate), member: record.id }));
  }
  for (const d of (record.defendants || [])) {
    if (d.canonicalId) {
      ops.push(kv.zadd(KEYS.byDefendant(d.canonicalId), { score: epochOrZero(record.filingDate), member: record.id }));
    }
  }
  await Promise.all(ops);
}

export async function unindexCase(record) {
  const ops = [
    kv.del(KEYS.case(record.id)),
    kv.zrem(KEYS.byFilingDate(), record.id),
    kv.zrem(KEYS.bySettlementDate(), record.id),
  ];
  for (const status of CASE_STATUSES) ops.push(kv.zrem(KEYS.byStatus(status), record.id));
  if (record.court?.state) ops.push(kv.zrem(KEYS.byState(record.court.state), record.id));
  for (const st of (record.eligibleStates || [])) ops.push(kv.zrem(KEYS.byState(st), record.id));
  for (const d of (record.defendants || [])) {
    if (d.canonicalId) ops.push(kv.zrem(KEYS.byDefendant(d.canonicalId), record.id));
  }
  await Promise.all(ops);
}

// Upsert one raw case input through validate → resolve defendants → index.
// Returns { id, action: 'created' | 'updated' | 'unchanged' }.
export async function importCase(raw) {
  const defendants = await resolveDefendantsForCase(raw.defendants);
  const candidate = buildCase({ ...raw, defendants });

  let action = "created";
  if (raw.id) {
    const existing = await kv.get(KEYS.case(raw.id)).catch(() => null);
    if (existing) {
      const prev = typeof existing === "string" ? JSON.parse(existing) : existing;
      // Preserve original ingestedAt; refresh lastVerifiedAt.
      candidate.ingestedAt = prev.ingestedAt || candidate.ingestedAt;
      candidate.lastVerifiedAt = new Date().toISOString();
      const same = JSON.stringify({ ...prev, lastVerifiedAt: null }) ===
                   JSON.stringify({ ...candidate, lastVerifiedAt: null });
      if (same) {
        // Touch lastVerifiedAt only — no need to re-index.
        await kv.set(KEYS.case(raw.id), JSON.stringify(candidate), { ex: 365 * 24 * 3600 });
        return { id: raw.id, action: "unchanged" };
      }
      // Status change → remove from old status index before re-indexing.
      if (prev.status !== candidate.status) {
        await kv.zrem(KEYS.byStatus(prev.status), raw.id).catch(() => {});
      }
      action = "updated";
    }
  }

  await indexCase(candidate);
  return { id: candidate.id, action };
}

// Bulk import with per-record error isolation. Always invalidates the full-list cache.
export async function importCases(rawArray) {
  const created = [];
  const updated = [];
  const unchanged = [];
  const errors = [];

  for (const raw of rawArray) {
    try {
      const result = await importCase(raw);
      if (result.action === "created") created.push(result.id);
      else if (result.action === "updated") updated.push(result.id);
      else unchanged.push(result.id);
    } catch (e) {
      errors.push({ input: raw, error: e.message });
    }
  }

  await kv.del(KEYS.cacheFull()).catch(() => {});

  return {
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    errors,
    ids: { created, updated, unchanged },
  };
}
