// Settlement claim tracker.
//
// GET  /api/claims?caseId=X          — all claims for a case
// GET  /api/claims?clientId=Y        — all claims for a client
// GET  /api/claims?status=submitted  — claims by status
// GET  /api/claims?upcoming=30       — deadlines within N days
// POST /api/claims                   — create claim(s)
// PATCH /api/claims                  — update status / add notes
// DELETE /api/claims?id=X            — delete claim
//
// KV schema:
//   claim:${id}                      full record (TTL 3 years)
//   claims_by_case:${caseId}         sorted set (score = createdAt epoch)
//   claims_by_client:${clientId}     sorted set
//   claims_by_status:${status}       sorted set
//   claims_deadlines                 sorted set (score = deadline epoch)

import { kv } from "@vercel/kv";

const CLAIM_TTL    = 3 * 365 * 24 * 3600;
const VALID_STATUS = ["identified","drafted","submitted","confirmed","paid","rejected","dismissed"];

function claimId() {
  return `clm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() { return new Date().toISOString(); }

// ── Write helpers ─────────────────────────────────────────────────────────

async function saveClaim(claim) {
  const ops = [
    kv.set(`claim:${claim.id}`, JSON.stringify(claim), { ex: CLAIM_TTL }),
    kv.zadd(`claims_by_case:${claim.caseId}`,   { score: Date.parse(claim.createdAt), member: claim.id }),
    kv.zadd(`claims_by_client:${claim.clientId}`,{ score: Date.parse(claim.createdAt), member: claim.id }),
    kv.zadd(`claims_by_status:${claim.status}`,  { score: Date.parse(claim.createdAt), member: claim.id }),
  ];
  if (claim.claimWindowCloses) {
    const deadline = Date.parse(claim.claimWindowCloses);
    if (!isNaN(deadline)) {
      ops.push(kv.zadd("claims_deadlines", { score: deadline, member: claim.id }));
    }
  }
  await Promise.all(ops);
  return claim;
}

async function getClaimById(id) {
  const raw = await kv.get(`claim:${id}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function resolveIds(ids) {
  if (!ids.length) return [];
  const raws = await Promise.all(ids.map(id => kv.get(`claim:${id}`).catch(() => null)));
  return raws.filter(Boolean).map(r => typeof r === "string" ? JSON.parse(r) : r);
}

// ── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET ─────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { caseId, clientId, status, upcoming, id } = req.query || {};

    if (id) {
      const c = await getClaimById(id);
      if (!c) return res.status(404).json({ error: "Claim not found" });
      return res.status(200).json({ claim: c });
    }

    if (upcoming) {
      const days = parseInt(upcoming) || 30;
      const now  = Date.now();
      const cutoff = now + days * 24 * 3600 * 1000;
      const ids = await kv.zrangebyscore("claims_deadlines", now, cutoff).catch(() => []);
      const claims = await resolveIds(ids);
      // Enrich with days remaining
      const enriched = claims.map(c => ({
        ...c,
        daysUntilDeadline: c.claimWindowCloses
          ? Math.ceil((Date.parse(c.claimWindowCloses) - now) / (1000 * 60 * 60 * 24))
          : null,
      }));
      enriched.sort((a, b) => (a.daysUntilDeadline ?? 9999) - (b.daysUntilDeadline ?? 9999));
      return res.status(200).json({ claims: enriched, total: enriched.length });
    }

    if (status) {
      const ids = await kv.zrange(`claims_by_status:${status}`, 0, -1, { rev: true }).catch(() => []);
      const claims = await resolveIds(ids);
      return res.status(200).json({ claims, total: claims.length });
    }

    if (caseId) {
      const ids = await kv.zrange(`claims_by_case:${caseId}`, 0, -1, { rev: true }).catch(() => []);
      const claims = await resolveIds(ids);
      return res.status(200).json({ claims, total: claims.length });
    }

    if (clientId) {
      const ids = await kv.zrange(`claims_by_client:${clientId}`, 0, -1, { rev: true }).catch(() => []);
      const claims = await resolveIds(ids);
      return res.status(200).json({ claims, total: claims.length });
    }

    // No filter — return recent 200
    const statusSets = await Promise.all(
      VALID_STATUS.map(s => kv.zrange(`claims_by_status:${s}`, 0, 49, { rev: true }).catch(() => []))
    );
    const allIds = [...new Set(statusSets.flat())].slice(0, 200);
    const claims = await resolveIds(allIds);
    claims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ claims, total: claims.length });
  }

  // ── POST — create claim(s) ───────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body || {};
    const items = Array.isArray(body.claims) ? body.claims : [body];
    const created = [];

    for (const item of items) {
      if (!item.caseId || !item.clientId) {
        return res.status(400).json({ error: "caseId and clientId required" });
      }

      // Check for duplicate
      const existingIds = await kv.zrange(`claims_by_case:${item.caseId}`, 0, -1).catch(() => []);
      const existing = await resolveIds(existingIds);
      const dupe = existing.find(c => c.clientId === item.clientId);
      if (dupe) {
        // Return existing rather than creating duplicate
        created.push(dupe);
        continue;
      }

      const now = nowIso();
      const claim = {
        id:               claimId(),
        caseId:           item.caseId,
        clientId:         item.clientId,
        clientName:       item.clientName || "",
        caseCaption:      item.caseCaption || "",
        caseType:         item.caseType || "TCPA",
        defendant:        item.defendant || "",
        status:           "identified",
        claimPortalUrl:   item.claimPortalUrl || null,
        claimNumber:      null,
        estimatedPayout:  item.estimatedPayout || null,
        submittedAt:      null,
        confirmedAt:      null,
        paidAt:           null,
        paymentAmount:    null,
        claimWindowCloses: item.claimWindowCloses || null,
        notes:            item.notes || "",
        createdAt:        now,
        updatedAt:        now,
      };
      await saveClaim(claim);
      created.push(claim);
    }

    return res.status(201).json({ claims: created, created: created.length });
  }

  // ── PATCH — update status, notes, claim number ───────────────────────────
  if (req.method === "PATCH") {
    const { id, status, notes, claimNumber, paymentAmount, paidAt, submittedAt, confirmedAt, claimPortalUrl } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });

    const existing = await getClaimById(id);
    if (!existing) return res.status(404).json({ error: "Claim not found" });

    const oldStatus = existing.status;
    const updated = {
      ...existing,
      updatedAt: nowIso(),
    };
    if (status && VALID_STATUS.includes(status)) updated.status = status;
    if (notes     !== undefined) updated.notes        = notes;
    if (claimNumber !== undefined) updated.claimNumber = claimNumber;
    if (paymentAmount !== undefined) updated.paymentAmount = parseFloat(paymentAmount) || null;
    if (paidAt    !== undefined) updated.paidAt       = paidAt;
    if (submittedAt !== undefined) updated.submittedAt = submittedAt;
    if (confirmedAt !== undefined) updated.confirmedAt = confirmedAt;
    if (claimPortalUrl !== undefined) updated.claimPortalUrl = claimPortalUrl;

    // Auto-set timestamps
    if (status === "submitted" && !updated.submittedAt) updated.submittedAt = nowIso();
    if (status === "confirmed" && !updated.confirmedAt) updated.confirmedAt = nowIso();
    if (status === "paid"      && !updated.paidAt)      updated.paidAt      = nowIso();

    // Remove from old status set
    if (oldStatus !== updated.status) {
      await kv.zrem(`claims_by_status:${oldStatus}`, id).catch(() => {});
    }

    await saveClaim(updated);
    return res.status(200).json({ claim: updated });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "id required" });
    const existing = await getClaimById(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    await Promise.all([
      kv.del(`claim:${id}`),
      kv.zrem(`claims_by_case:${existing.caseId}`, id),
      kv.zrem(`claims_by_client:${existing.clientId}`, id),
      kv.zrem(`claims_by_status:${existing.status}`, id),
      kv.zrem("claims_deadlines", id),
    ]);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
