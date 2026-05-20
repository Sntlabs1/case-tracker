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
import { buildCase, KEYS, CASE_STATUSES, epochOrZero, caseSummary } from "./tcpaSchema.js";
import { resolveOrSuggest, createDefendant } from "./defendantResolver.js";
import { normalizePlaintiff } from "./tcpaIngestNormalize.js";

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
  for (const p of (record.plaintiffs || [])) {
    const norm = normalizePlaintiff(p);
    if (norm) {
      ops.push(kv.zadd(KEYS.byPlaintiff(norm), { score: epochOrZero(record.filingDate), member: record.id }));
      // Maintain a sorted-set roster of all plaintiff norms (score is updated
      // to current count on each index read — for cheap maintenance we just
      // bump by 1 and let stale scores drift; the Plaintiffs view re-reads
      // zcard() before display anyway).
      ops.push(kv.zincrby(KEYS.plaintiffIndex(), 1, norm));
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
  for (const p of (record.plaintiffs || [])) {
    const norm = normalizePlaintiff(p);
    if (norm) {
      ops.push(kv.zrem(KEYS.byPlaintiff(norm), record.id));
      ops.push(kv.zincrby(KEYS.plaintiffIndex(), -1, norm));
    }
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

  // Rebuild search index after any write — fire-and-forget so it doesn't
  // block the import response. The index is used for full client-side search.
  rebuildSearchIndex().catch(() => {});

  return {
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    errors,
    ids: { created, updated, unchanged },
  };
}

// Build (or rebuild) the compact search index stored as paginated KV keys.
// Each page holds 1,000 case summaries (~150KB). Pages are fetched in parallel
// by the UI so all 7k+ cases are searchable client-side.
export async function rebuildSearchIndex() {
  const PAGE_SIZE = 1000;
  const TTL = 24 * 3600;

  // Fetch all case IDs from the filing-date index
  const allIds = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  if (!allIds.length) return;

  // Fetch all records in batches of 100
  const FETCH_BATCH = 100;
  const summaries = [];
  for (let i = 0; i < allIds.length; i += FETCH_BATCH) {
    const batch = await Promise.all(
      allIds.slice(i, i + FETCH_BATCH).map(id => kv.get(KEYS.case(id)).catch(() => null))
    );
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      summaries.push(caseSummary(c));
    }
  }

  // Write pages
  const pages = Math.ceil(summaries.length / PAGE_SIZE);
  const writes = [];
  for (let p = 0; p < pages; p++) {
    const chunk = summaries.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    writes.push(kv.set(KEYS.searchPage(p), JSON.stringify(chunk), { ex: TTL }));
  }
  writes.push(kv.set(KEYS.searchMeta(), JSON.stringify({ pages, total: summaries.length, builtAt: new Date().toISOString() }), { ex: TTL }));
  await Promise.all(writes);
}
