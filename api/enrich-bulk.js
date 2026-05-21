// POST /api/enrich-bulk
// Runs Claude Haiku across all cases missing settlement details (d)-(g).
// Processes in batches of 20 so it fits in 300s. Call repeatedly until done.
//
// Query params:
//   ?status=settled   (default — most likely to have settlement info)
//   ?status=active    (for active cases to fill conduct descriptions)
//   ?limit=100        (cases per run, default 100)
//   ?offset=0         (pagination cursor)

import { kv } from "@vercel/kv";
import { KEYS } from "../src/lib/tcpaSchema.js";
import { rebuildSearchIndex } from "../src/lib/tcpaCaseStore.js";

const HAIKU = "claude-haiku-4-5-20251001";

async function callHaiku(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Haiku ${r.status}`);
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Ask Claude what it knows about a specific case's settlement details
async function enrichCase(record) {
  const defendants = (record.defendants || []).map(d => d.displayName).join(", ");
  const prompt = `You are a legal research assistant. Extract settlement details for this class action from your training knowledge. Return ONLY a JSON object — null values for anything you don't know with confidence.

Case: ${record.caption}
Defendants: ${defendants}
Type: ${record.caseType}
Court: ${record.court?.name || "unknown"}
Filed: ${record.filingDate || "unknown"}
${record.settlement?.claimPortalUrl ? `Known portal: ${record.settlement.claimPortalUrl}` : ""}

{
  "perClaimantRange": "$XX–$XX or null",
  "totalFund": "$X,XXX,XXX or null",
  "claimPortalUrl": "URL or null",
  "claimWindowCloses": "YYYY-MM-DD or null",
  "claimRequirements": "exact class definition or null",
  "adminName": "settlement administrator company or null",
  "adminPhone": "toll-free number or null",
  "adminEmail": "email or null",
  "adminWebsite": "URL or null",
  "conductDescription": "one sentence what defendant did or null"
}`;

  const raw = await callHaiku(prompt);
  return parseJson(raw);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const status = req.query?.status || "settled";
  const limit  = Math.min(parseInt(req.query?.limit || "100"), 200);
  const offset = parseInt(req.query?.offset || "0");

  // Get candidate IDs from status index
  const allIds = await kv.zrange(KEYS.byStatus(status), 0, -1, { rev: true }).catch(() => []);
  const slice  = allIds.slice(offset, offset + limit);

  if (!slice.length) {
    return res.status(200).json({ ok: true, processed: 0, enriched: 0, total: allIds.length, done: true });
  }

  // Fetch records
  const BATCH = 50;
  const records = [];
  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = await Promise.all(
      slice.slice(i, i + BATCH).map(id => kv.get(KEYS.case(id)).catch(() => null))
    );
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      // Only enrich cases missing key settlement fields
      const needsEnrich = !c.settlement?.perClaimantRange || !c.settlement?.adminName || !c.conductDescription;
      if (needsEnrich) records.push(c);
    }
  }

  // Enrich in parallel batches of 5 (Haiku is fast)
  let enriched = 0;
  const ENRICH_BATCH = 5;
  for (let i = 0; i < records.length; i += ENRICH_BATCH) {
    const batch = records.slice(i, i + ENRICH_BATCH);
    const results = await Promise.allSettled(batch.map(async (c) => {
      const details = await enrichCase(c);
      if (!details) return;

      const updated = { ...c };
      updated.settlement = { ...c.settlement };
      // Only fill missing fields — don't overwrite existing good data
      const sFields = ["perClaimantRange", "totalFund", "claimPortalUrl", "claimWindowCloses",
                       "claimRequirements", "adminName", "adminPhone", "adminEmail", "adminWebsite"];
      for (const f of sFields) {
        if (details[f] && !updated.settlement[f]) updated.settlement[f] = details[f];
      }
      if (details.conductDescription && !updated.conductDescription) {
        updated.conductDescription = details.conductDescription;
      }

      await kv.set(KEYS.case(c.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 });
      enriched++;
    }));
    // Count successes
    enriched = results.filter(r => r.status === "fulfilled").length + enriched;
  }

  const hasMore = (offset + limit) < allIds.length;

  // Rebuild search index so new data is searchable
  if (!hasMore) await rebuildSearchIndex().catch(() => {});

  return res.status(200).json({
    ok: true,
    processed: records.length,
    enriched,
    total: allIds.length,
    nextOffset: hasMore ? offset + limit : null,
    done: !hasMore,
  });
}
