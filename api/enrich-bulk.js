// POST /api/enrich-bulk
// Runs Claude Haiku across ALL cases to fill settlement website (f),
// administrator contact (g), per-claimant amount (e), class requirements (d),
// and conduct description for every case in the system regardless of status.
//
// Reads from the full filing-date index so it covers all 7,500+ cases.
// Safe to call repeatedly — only fills missing fields, never overwrites.
//
// Query params:
//   ?limit=100    cases per call (default 100, max 150)
//   ?offset=0     pagination cursor

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
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Haiku ${r.status}`);
  return (await r.json()).content?.[0]?.text || "";
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function enrichCase(record) {
  const defendants = (record.defendants || []).map(d => d.displayName).join(", ");
  const prompt = `You are a legal research assistant for a plaintiff law firm. Extract settlement details for this class action from your training knowledge. Return null for anything you are not confident about — do NOT guess.

Case: ${record.caption}
Defendants: ${defendants}
Type: ${record.caseType}
Court: ${record.court?.name || "unknown"}
Filed: ${record.filingDate || "unknown"}
Status: ${record.status || "unknown"}
${record.settlement?.claimPortalUrl ? `Known claim portal: ${record.settlement.claimPortalUrl}` : ""}

Return ONLY a JSON object:
{
  "perClaimantRange": "e.g. $75 flat or $20-$40 or null",
  "totalFund": "e.g. $5,975,000 or null",
  "claimPortalUrl": "direct URL to file a claim or settlement website, or null",
  "claimWindowCloses": "YYYY-MM-DD deadline or null",
  "claimRequirements": "exact class definition — who qualifies, or null",
  "adminName": "settlement administrator company name e.g. Kroll Settlement Administration, Epiq Class Action Solutions, Simpluris, JND Legal Administration, or null",
  "adminPhone": "toll-free phone number for claimants or null",
  "adminEmail": "email address for claimant inquiries or null",
  "adminWebsite": "URL to administrator website or null",
  "conductDescription": "one sentence: what the defendant did that violated the law, or null"
}`;

  const raw = await callHaiku(prompt);
  return parseJson(raw);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const limit  = Math.min(parseInt(req.query?.limit  || "100"), 150);
  const offset = parseInt(req.query?.offset || "0");

  // Use the full filing-date index — covers all 7,500+ cases across all statuses
  const allIds = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  const slice  = allIds.slice(offset, offset + limit);

  if (!slice.length) {
    return res.status(200).json({ ok: true, processed: 0, enriched: 0, total: allIds.length, done: true });
  }

  // Fetch records in parallel
  const FETCH_BATCH = 50;
  const records = [];
  for (let i = 0; i < slice.length; i += FETCH_BATCH) {
    const batch = await Promise.all(
      slice.slice(i, i + FETCH_BATCH).map(id => kv.get(KEYS.case(id)).catch(() => null))
    );
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      // Enrich any case missing at least one of the key fields
      const missing =
        !c.settlement?.adminName ||
        !c.settlement?.claimPortalUrl ||
        !c.settlement?.perClaimantRange ||
        !c.conductDescription;
      if (missing) records.push(c);
    }
  }

  // Enrich in parallel batches of 8
  let enriched = 0;
  const ENRICH_BATCH = 8;
  for (let i = 0; i < records.length; i += ENRICH_BATCH) {
    const batch = records.slice(i, i + ENRICH_BATCH);
    const results = await Promise.allSettled(batch.map(async (c) => {
      const details = await enrichCase(c);
      if (!details) return false;

      const updated = { ...c, settlement: { ...(c.settlement || {}) } };

      const sFields = [
        "perClaimantRange", "totalFund", "claimPortalUrl", "claimWindowCloses",
        "claimRequirements", "adminName", "adminPhone", "adminEmail", "adminWebsite",
      ];
      let changed = false;
      for (const f of sFields) {
        if (details[f] && !updated.settlement[f]) {
          updated.settlement[f] = details[f];
          changed = true;
        }
      }
      if (details.conductDescription && !updated.conductDescription) {
        updated.conductDescription = details.conductDescription;
        changed = true;
      }

      if (changed) {
        await kv.set(KEYS.case(c.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 });
        return true;
      }
      return false;
    }));
    enriched += results.filter(r => r.status === "fulfilled" && r.value === true).length;
  }

  const hasMore = (offset + limit) < allIds.length;

  // Rebuild search index on final page so UI reflects new data
  if (!hasMore) await rebuildSearchIndex().catch(() => {});

  return res.status(200).json({
    ok: true,
    processed: records.length,
    enriched,
    skipped: slice.length - records.length,
    total: allIds.length,
    nextOffset: hasMore ? offset + limit : null,
    done: !hasMore,
  });
}
