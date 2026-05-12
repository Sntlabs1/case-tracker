// Partner registry — first-class entity for ingestion-side partnerships
// (Credit.com first, future partners follow the same pattern).
//
// GET    /api/partners              — list all partners with last-import stats
// GET    /api/partners?id=<id>      — fetch one partner
// POST   /api/partners  body: {...} — create
// PATCH  /api/partners  body: {id, ...patch} — update mutable fields
// DELETE /api/partners?id=<id>      — soft delete (status: "paused")
//
// Storage:
//   partner:${id}        — JSON record
//   partner:registry     — sorted set of partner IDs (score = createdAt epoch)

import { kv } from "@vercel/kv";

const REGISTRY_KEY = "partner:registry";
const partnerKey = (id) => `partner:${id}`;

const VALID_STATUSES = ["active", "paused"];

function nowIso() { return new Date().toISOString(); }

function buildPartner(input, existing = null) {
  const id = (input.id || existing?.id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) throw new Error("partner id required (lowercase, underscores)");
  if (!input.name && !existing?.name) throw new Error("partner name required");

  return {
    id,
    name:             input.name             ?? existing?.name,
    contractDate:     input.contractDate     ?? existing?.contractDate ?? null,
    status:           VALID_STATUSES.includes(input.status) ? input.status : (existing?.status || "active"),
    defaultCaseTypes: Array.isArray(input.defaultCaseTypes) ? input.defaultCaseTypes
                       : (existing?.defaultCaseTypes || ["TCPA", "FDCPA", "FCRA"]),
    notes:            input.notes            ?? existing?.notes ?? "",
    createdAt:        existing?.createdAt    ?? nowIso(),
    updatedAt:        nowIso(),
  };
}

async function readPartner(id) {
  const raw = await kv.get(partnerKey(id)).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function listPartners() {
  const ids = await kv.zrange(REGISTRY_KEY, 0, -1).catch(() => []);
  const records = await Promise.all(ids.map(readPartner));
  return records.filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { id } = req.query;
    if (id) {
      const p = await readPartner(id);
      if (!p) return res.status(404).json({ error: "partner not found" });
      return res.status(200).json({ partner: p });
    }
    const partners = await listPartners();
    return res.status(200).json({ partners });
  }

  // ── POST — create ──────────────────────────────────────────────────────────
  if (req.method === "POST") {
    let record;
    try { record = buildPartner(req.body || {}); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const exists = await readPartner(record.id);
    if (exists) return res.status(409).json({ error: `partner '${record.id}' already exists` });

    await Promise.all([
      kv.set(partnerKey(record.id), JSON.stringify(record), { ex: 365 * 24 * 3600 }),
      kv.zadd(REGISTRY_KEY, { score: Date.now(), member: record.id }),
    ]);
    return res.status(201).json({ partner: record });
  }

  // ── PATCH — update mutable fields ──────────────────────────────────────────
  if (req.method === "PATCH") {
    const body = req.body || {};
    if (!body.id) return res.status(400).json({ error: "id required" });
    const existing = await readPartner(body.id);
    if (!existing) return res.status(404).json({ error: "partner not found" });

    let updated;
    try { updated = buildPartner({ ...body, id: existing.id }, existing); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    await kv.set(partnerKey(existing.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 });
    return res.status(200).json({ partner: updated });
  }

  // ── DELETE — soft delete (status: "paused") ───────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    const existing = await readPartner(id);
    if (!existing) return res.status(404).json({ error: "partner not found" });
    existing.status = "paused";
    existing.updatedAt = nowIso();
    await kv.set(partnerKey(id), JSON.stringify(existing), { ex: 365 * 24 * 3600 });
    return res.status(200).json({ partner: existing });
  }

  return res.status(405).json({ error: "method not allowed" });
}
