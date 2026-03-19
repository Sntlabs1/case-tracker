// Vercel serverless — client database CRUD
// GET    /api/clients                        — list all clients (optional ?firm=X&state=Y&q=search)
// POST   /api/clients  body: { clients: [] } — bulk import (or single { client: {} })
// PATCH  /api/clients  body: { id, retainerStatus, retainerHistory? } — update status
// DELETE /api/clients?id=xyz               — remove a client

import { kv } from "@vercel/kv";

const CLIENTS_CACHE_KEY = "clients_cache_v1";
const CLIENTS_ZSET      = "clients_by_date";
const CACHE_TTL         = 300; // 5 min

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
    await Promise.all([kv.del(`client:${id}`), kv.zrem(CLIENTS_ZSET, id)]);
    await kv.del(CLIENTS_CACHE_KEY).catch(() => {});
    return res.status(200).json({ deleted: id });
  }

  // ── POST — bulk import ─────────────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body || {};
    const incoming = body.clients || (body.client ? [body.client] : []);
    if (!incoming.length) return res.status(400).json({ error: "clients array required" });

    const now = Date.now();
    const ops = incoming.map((c, i) => {
      const id = c.id || `c_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`;
      const record = {
        id,
        firstName:       c.firstName   || c.first_name   || "",
        lastName:        c.lastName    || c.last_name     || "",
        email:           c.email       || "",
        phone:           c.phone       || "",
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
        matchedLeads:    [],   // populated by match engine
      };
      return { id, record, ts: now + i };
    });

    // Write in parallel — kv.set + zset score = timestamp
    await Promise.all(ops.flatMap(({ id, record, ts }) => [
      kv.set(`client:${id}`, JSON.stringify(record), { ex: 365 * 24 * 3600 }),
      kv.zadd(CLIENTS_ZSET, { score: ts, member: id }),
    ]));
    await kv.del(CLIENTS_CACHE_KEY).catch(() => {});

    return res.status(200).json({ imported: ops.length, ids: ops.map(o => o.id) });
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
