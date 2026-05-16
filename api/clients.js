// Vercel serverless — client database CRUD
// GET    /api/clients                                         — list all clients (optional ?firm=X&state=Y&q=search)
// POST   /api/clients?partner=credit_com  body: { clients: [] } — bulk import via partner importer (preferred)
// POST   /api/clients?source=credit_com   body: { clients: [] } — legacy alias for ?partner=credit_com
// POST   /api/clients                     body: { clients: [] } — manual ingest (no normalization)
// PATCH  /api/clients  body: { id, retainerStatus, retainerHistory? } — update status
// DELETE /api/clients?id=xyz               — remove a client
//
// Every imported/updated client ID gets pushed to `tcpa:clients_pending_match`
// so the match-recompute agent picks them up on its next tick.

import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import {
  normalize as normalizeDefendant,
  createDefendant,
} from "../src/lib/defendantResolver.js";

const CLIENTS_PENDING_MATCH = "tcpa:clients_pending_match";

// ── Bulk-resolve creditor / debt-buyer canonical IDs ────────────────────────
// Partner ingest delivers raw creditor / debt-buyer strings on each client's
// collectionsHistory entries. The matcher's candidate-set path relies on
// those names being linked to canonical defendant IDs so it can pull the
// inverted-index lookups (tcpa:cases_by_defendant:${cId}).
//
// Per-row resolveOrSuggest would hit the O(N) trigram fallback on every new
// name — fine for a few rows, intractable for a partner batch. This walks an
// incoming batch once, collects unique normalized names, does ONE alias-table
// lookup per name (parallel), and createDefendant for misses. Then back-fills
// canonicalId on each collectionsHistory entry in place.
//
// Safe to call with `[]` or rows without collectionsHistory.
async function bulkResolveCollectionsCanonicalIds(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  // 1. Gather unique normalized names (creditor + debtBuyer) that lack canonicalId
  const uniqueNames = new Map(); // norm → first-seen display
  for (const r of rows) {
    for (const e of (r?.collectionsHistory || [])) {
      if (e.creditor && !e.creditorCanonicalId) {
        const norm = normalizeDefendant(e.creditor);
        if (norm && !uniqueNames.has(norm)) uniqueNames.set(norm, e.creditor);
      }
      if (e.debtBuyer && !e.debtBuyerCanonicalId) {
        const norm = normalizeDefendant(e.debtBuyer);
        if (norm && !uniqueNames.has(norm)) uniqueNames.set(norm, e.debtBuyer);
      }
    }
  }
  if (!uniqueNames.size) return;

  // 2. Single alias-table lookup per unique name (batched parallel)
  const cache = new Map(); // norm → canonicalId
  const normList = [...uniqueNames.keys()];
  const LOOKUP_BATCH = 100;
  for (let i = 0; i < normList.length; i += LOOKUP_BATCH) {
    const slice = normList.slice(i, i + LOOKUP_BATCH);
    const results = await Promise.all(
      slice.map((n) => kv.get(`tcpa:defendant_alias:${n}`).catch(() => null))
    );
    slice.forEach((n, j) => {
      if (results[j]) cache.set(n, results[j]);
    });
  }

  // 3. createDefendant for misses (sequential so simultaneous creates don't
  // collide on the shared sorted-set indexes maintained by createDefendant)
  for (const norm of normList) {
    if (cache.has(norm)) continue;
    const display = uniqueNames.get(norm);
    try {
      const created = await createDefendant({ displayName: display });
      cache.set(norm, created.canonicalId);
    } catch {
      // skip — entry will fall back to alias lookup at match time
    }
  }

  // 4. Back-fill canonicalIds onto each row's collectionsHistory in place
  for (const r of rows) {
    for (const e of (r?.collectionsHistory || [])) {
      if (!e.creditorCanonicalId && e.creditor) {
        const cId = cache.get(normalizeDefendant(e.creditor));
        if (cId) e.creditorCanonicalId = cId;
      }
      if (!e.debtBuyerCanonicalId && e.debtBuyer) {
        const cId = cache.get(normalizeDefendant(e.debtBuyer));
        if (cId) e.debtBuyerCanonicalId = cId;
      }
    }
  }
}

async function loadPartnerImporter(partnerId) {
  // Verify partner exists in registry; importer file must match the id.
  const partner = await kv.get(`partner:${partnerId}`).catch(() => null);
  if (!partner) return null;
  try {
    // File names use hyphens (credit-com.js) for the underscore-separated id (credit_com).
    const filename = partnerId.replace(/_/g, "-");
    const mod = await import(`./_partner-importers/${filename}.js`);
    return mod.default;
  } catch (e) {
    return null;
  }
}

const CLIENTS_CACHE_KEY = "clients_cache_v1";
const CLIENTS_ZSET      = "clients_by_date";
const CACHE_TTL         = 300; // 5 min

// ── PII / dedup helpers ──────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}
function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}
function sha256(s) {
  if (!s) return "";
  return createHash("sha256").update(s).digest("hex");
}

// Legacy inline credit.com normalizer — kept as a fallback for the
// `?source=credit_com` alias when the partner registry hasn't been seeded yet.
// New code should rely on the per-partner importer at
// api/_partner-importers/<id>.js, dispatched via the `partner:<id>` registry.
function normalizeCreditCom(c) {
  const phones = []
    .concat(c.phone, c.phones, c.mobile, c.home_phone, c.cell)
    .filter(Boolean)
    .map(normalizePhone)
    .filter(Boolean);
  const collections = Array.isArray(c.collections || c.collectionsHistory)
    ? (c.collections || c.collectionsHistory).map((e) => ({
        creditor:             e.creditor || e.original_creditor || "",
        creditorCanonicalId:  e.creditorCanonicalId || null,
        debtBuyer:            e.debtBuyer || e.debt_buyer || e.collector || null,
        debtBuyerCanonicalId: e.debtBuyerCanonicalId || null,
        dateRange: {
          start: e.dateRange?.start || e.start_date || null,
          end:   e.dateRange?.end   || e.end_date   || null,
        },
        amount:         e.amount ?? null,
        status:         e.status || "active",
        contactMethods: e.contactMethods || e.contact_methods || [],
        contactDates:   e.contactDates   || e.contact_dates   || [],
        source: "credit.com",
      }))
    : [];
  const addresses = Array.isArray(c.addressHistory || c.addresses)
    ? (c.addressHistory || c.addresses).map((a) => ({
        state: (a.state || "").toUpperCase().slice(0, 2),
        city:  a.city  || "",
        zip:   a.zip   || a.postal_code || "",
        start: a.start || a.start_date  || null,
        end:   a.end   || a.end_date    || null,
      }))
    : [];
  return {
    ...c,
    phoneNumbers:       phones,
    phone:              c.phone || phones[0] || "",
    collectionsHistory: collections,
    addressHistory:     addresses,
    partnerId:          "credit_com",
    ingestSource:       "credit.com",
    contactRights: {
      creditor:  true,
      source:    "credit.com partnership",
      scopeNote: c.scopeNote || "Credit.com has consent to contact for partnership-relevant matters.",
    },
    tcpaOptOut: c.tcpaOptOut === true,
  };
}

function buildClientRecord(c, idx, now) {
  const id = c.id || `c_${now}_${idx}_${Math.random().toString(36).slice(2, 7)}`;
  const phoneNumbers = Array.isArray(c.phoneNumbers) && c.phoneNumbers.length
    ? c.phoneNumbers.map(normalizePhone).filter(Boolean)
    : (c.phone ? [normalizePhone(c.phone)].filter(Boolean) : []);
  const primaryPhone = phoneNumbers[0] || "";
  const email = normalizeEmail(c.email);
  return {
    id,
    firstName:       c.firstName   || c.first_name   || "",
    lastName:        c.lastName    || c.last_name     || "",
    email,
    phone:           primaryPhone,
    phoneNumbers,
    state:           (c.state      || "").toUpperCase().slice(0, 2),
    city:            c.city        || "",
    dob:             c.dob         || c.date_of_birth || "",
    age:             c.age         ? parseInt(c.age) : null,
    sourceFirm:      c.sourceFirm  || c.firm          || "Unknown Firm",
    originalCaseType:c.originalCaseType || c.case_type || "",
    injuries:        c.injuries    || "",
    productsUsed:    c.productsUsed || c.products     || "",
    medicationsUsed: c.medicationsUsed || c.medications || "",
    exposurePeriod:  c.exposurePeriod  || c.exposure   || "",
    occupation:      c.occupation  || "",
    caseNotes:       c.caseNotes   || c.notes         || "",
    existingCases:   c.existingCases   || "",
    importedAt:      new Date(c.importedAt || now).toISOString(),
    matchedLeads:    c.matchedLeads    || [],
    // ── Partnership-match additions ────────────────────────────────────────
    phoneHash:          primaryPhone ? sha256(primaryPhone) : "",
    emailHash:          email ? sha256(email) : "",
    collectionsHistory: Array.isArray(c.collectionsHistory) ? c.collectionsHistory : [],
    addressHistory:     Array.isArray(c.addressHistory) ? c.addressHistory : [],
    ingestSource:       c.ingestSource || "manual",
    partnerId:          c.partnerId || "manual",
    contactRights:      c.contactRights || null,
    tcpaOptOut:         c.tcpaOptOut === true,
  };
}

// Look up an existing client by hashed phone or email. Returns existing client
// record (parsed) or null.
async function findExistingByHash({ phoneHash, emailHash }) {
  for (const hash of [phoneHash, emailHash]) {
    if (!hash) continue;
    const existingId = await kv.get(`client_by_phonehash:${hash}`).catch(() => null)
      || await kv.get(`client_by_emailhash:${hash}`).catch(() => null);
    if (existingId) {
      const raw = await kv.get(`client:${existingId}`);
      if (raw) return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
  }
  return null;
}

// Merge a fresh record onto an existing one. Credit.com data wins for
// collectionsHistory; most-recent wins elsewhere.
function mergeClientRecords(existing, fresh) {
  const merged = { ...existing };
  // Most-recent wins for scalar fields (drop empty fresh values)
  for (const k of ["firstName", "lastName", "city", "state", "dob", "age",
                   "sourceFirm", "originalCaseType", "injuries", "productsUsed",
                   "medicationsUsed", "exposurePeriod", "occupation", "caseNotes",
                   "existingCases", "ingestSource", "partnerId", "contactRights"]) {
    if (fresh[k] !== undefined && fresh[k] !== null && fresh[k] !== "") merged[k] = fresh[k];
  }
  // Merge phone numbers (union)
  merged.phoneNumbers = [...new Set([...(existing.phoneNumbers || []), ...(fresh.phoneNumbers || [])])];
  if (fresh.phone) merged.phone = fresh.phone;
  if (fresh.email) merged.email = fresh.email;
  if (fresh.phoneHash) merged.phoneHash = fresh.phoneHash;
  if (fresh.emailHash) merged.emailHash = fresh.emailHash;
  // Credit.com wins for collectionsHistory if present
  if (fresh.collectionsHistory?.length) merged.collectionsHistory = fresh.collectionsHistory;
  // Address history union
  merged.addressHistory = [...(existing.addressHistory || []), ...(fresh.addressHistory || [])];
  // OR opt-out (once opted out, stays opted out)
  merged.tcpaOptOut = !!(existing.tcpaOptOut || fresh.tcpaOptOut);
  // Audit trail
  merged.mergeHistory = [
    ...(existing.mergeHistory || []),
    { at: new Date().toISOString(), source: fresh.ingestSource || "manual", incomingId: fresh.id },
  ];
  return merged;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── PATCH — update retainer status ────────────────────────────────────────
  if (req.method === "PATCH") {
    const { id, retainerStatus, retainerHistory } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });
    const raw = await kv.get(`client:${id}`);
    if (!raw) return res.status(404).json({ error: "Client not found" });
    const client = typeof raw === "string" ? JSON.parse(raw) : raw;
    const updated = {
      ...client,
      retainerStatus: retainerStatus ?? client.retainerStatus,
      retainerHistory: retainerHistory ?? [
        ...(client.retainerHistory || []),
        ...(retainerStatus && retainerStatus !== client.retainerStatus
          ? [{ status: retainerStatus, at: new Date().toISOString() }]
          : []),
      ],
    };
    await kv.set(`client:${id}`, JSON.stringify(updated), { ex: 365 * 24 * 3600 });
    await kv.del(CLIENTS_CACHE_KEY).catch(() => {});
    return res.status(200).json({ updated: id, retainerStatus: updated.retainerStatus });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    // Read existing record to clean up hash lookups; ignore if already gone.
    const raw = await kv.get(`client:${id}`).catch(() => null);
    const ops = [kv.del(`client:${id}`), kv.zrem(CLIENTS_ZSET, id)];
    if (raw) {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (c.phoneHash) ops.push(kv.del(`client_by_phonehash:${c.phoneHash}`));
      if (c.emailHash) ops.push(kv.del(`client_by_emailhash:${c.emailHash}`));
    }
    await Promise.all(ops);
    await kv.del(CLIENTS_CACHE_KEY).catch(() => {});
    return res.status(200).json({ deleted: id });
  }

  // ── POST — bulk import ─────────────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body || {};
    const rawIncoming = body.clients || (body.client ? [body.client] : []);
    if (!rawIncoming.length) return res.status(400).json({ error: "clients array required" });

    // Partner dispatch: prefer ?partner=<id> (registry-driven); fall back to
    // ?source=credit_com legacy alias and the inline normalizer.
    const partnerParam = (req.query?.partner || req.query?.source || "").toLowerCase();
    const partnerId = partnerParam === "credit_com" || partnerParam === "credit.com"
      ? "credit_com"
      : partnerParam;

    let importer = null;
    if (partnerId) importer = await loadPartnerImporter(partnerId);
    // Backward-compat: if the legacy alias was used but the partner registry
    // hasn't been seeded yet, fall back to the inline normalizer.
    if (!importer && partnerId === "credit_com") importer = normalizeCreditCom;

    const incoming = importer ? rawIncoming.map(importer) : rawIncoming;

    // Bulk-resolve creditor / debt-buyer canonical IDs across the whole batch
    // BEFORE the per-row dedup/persist loop. Without this, the matcher's
    // candidate-set path can't link clients to cases via the defendant index.
    await bulkResolveCollectionsCanonicalIds(incoming);

    const now = Date.now();
    const imported = [];
    const updated = [];
    const invalid = [];
    const queuedIds = [];

    // Sequential per-record so dedup-merge is consistent within a batch.
    for (let i = 0; i < incoming.length; i++) {
      let fresh;
      try { fresh = buildClientRecord(incoming[i], i, now); }
      catch (e) { invalid.push({ index: i, error: e.message }); continue; }

      // Minimum viability: must have at least one of (phone, email) for dedup
      // and at least a name. Otherwise the record is too thin to match cases.
      if (!fresh.phoneHash && !fresh.emailHash) {
        invalid.push({ index: i, error: "no phone or email — cannot dedup or contact" });
        continue;
      }
      if (!fresh.firstName && !fresh.lastName) {
        invalid.push({ index: i, error: "no firstName or lastName" });
        continue;
      }

      const existing = await findExistingByHash({
        phoneHash: fresh.phoneHash,
        emailHash: fresh.emailHash,
      });

      let targetId;
      if (existing) {
        const mergedRecord = mergeClientRecords(existing, fresh);
        await Promise.all([
          kv.set(`client:${existing.id}`, JSON.stringify(mergedRecord), { ex: 365 * 24 * 3600 }),
          fresh.phoneHash ? kv.set(`client_by_phonehash:${fresh.phoneHash}`, existing.id, { ex: 365 * 24 * 3600 }) : null,
          fresh.emailHash ? kv.set(`client_by_emailhash:${fresh.emailHash}`, existing.id, { ex: 365 * 24 * 3600 }) : null,
        ].filter(Boolean));
        updated.push(existing.id);
        targetId = existing.id;
      } else {
        const ts = now + i;
        const ops = [
          kv.set(`client:${fresh.id}`, JSON.stringify(fresh), { ex: 365 * 24 * 3600 }),
          kv.zadd(CLIENTS_ZSET, { score: ts, member: fresh.id }),
        ];
        if (fresh.phoneHash) ops.push(kv.set(`client_by_phonehash:${fresh.phoneHash}`, fresh.id, { ex: 365 * 24 * 3600 }));
        if (fresh.emailHash) ops.push(kv.set(`client_by_emailhash:${fresh.emailHash}`, fresh.id, { ex: 365 * 24 * 3600 }));
        await Promise.all(ops);
        imported.push(fresh.id);
        targetId = fresh.id;
      }

      // Enqueue for the match-recompute agent. Sorted set, score = ingest
      // time so older items get processed first.
      await kv.zadd(CLIENTS_PENDING_MATCH, { score: now + i, member: targetId }).catch(() => {});
      queuedIds.push(targetId);
    }

    await kv.del(CLIENTS_CACHE_KEY).catch(() => {});

    return res.status(200).json({
      partnerId: partnerId || "manual",
      imported: imported.length,
      updated:  updated.length,
      invalid:  invalid.length,
      queuedForMatch: queuedIds.length,
      ids: imported,
      updatedIds: updated,
      errors: invalid,
    });
  }

  // ── GET — list clients ─────────────────────────────────────────────────────
  if (req.method !== "GET") return res.status(405).end();

  const { firm, state, q, limit = "5000" } = req.query;
  const lim = Math.min(parseInt(limit), 10000);
  const isDefault = !firm && !state && !q && lim >= 5000;

  // Try cache for unfiltered full fetch
  if (isDefault) {
    try {
      const cached = await kv.get(CLIENTS_CACHE_KEY);
      if (cached) {
        const data = typeof cached === "string" ? JSON.parse(cached) : cached;
        return res.status(200).json({ ...data, cached: true });
      }
    } catch {}
  }

  // Fetch all IDs from sorted set (most-recent-first = desc)
  const ids = await kv.zrange(CLIENTS_ZSET, 0, -1, { rev: true }).catch(() => []);
  if (!ids.length) return res.status(200).json({ clients: [], total: 0 });

  // Batch fetch records
  const BATCH = 200;
  const records = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = await Promise.all(ids.slice(i, i + BATCH).map(id => kv.get(`client:${id}`)));
    batch.forEach(r => {
      if (!r) return;
      const c = typeof r === "string" ? JSON.parse(r) : r;
      // Apply filters
      if (firm && c.sourceFirm !== firm) return;
      if (state && c.state !== state.toUpperCase()) return;
      if (q) {
        const ql = q.toLowerCase();
        const haystack = `${c.firstName} ${c.lastName} ${c.injuries} ${c.productsUsed} ${c.medicationsUsed} ${c.originalCaseType}`.toLowerCase();
        if (!haystack.includes(ql)) return;
      }
      records.push(c);
    });
    if (records.length >= lim) break;
  }

  // Aggregate firm list for filter UI
  const firms = [...new Set(records.map(c => c.sourceFirm).filter(Boolean))].sort();

  const payload = {
    clients: records.slice(0, lim),
    total:   ids.length,
    filtered: records.length,
    firms,
  };
  if (isDefault) {
    await kv.set(CLIENTS_CACHE_KEY, JSON.stringify(payload), { ex: CACHE_TTL }).catch(() => {});
  }
  return res.status(200).json(payload);
}
