// POST /api/enrich-bulk
// Enriches all 7,500+ cases with settlement details using two strategies:
//
// 1. SEED MATCH (instant, no Claude): match each case's defendant against
//    the 93-entry KNOWN_SETTLEMENTS database. Fills per-claimant, total fund,
//    class definition, conduct description for every matching case.
//
// 2. CLAUDE HAIKU (for everything else): batch-asks Claude what it knows.
//    Only sends cases where seed didn't match AND fields are still missing.
//    For obscure cases Claude will return nulls — that's fine.
//
// Always generates a conductDescription if missing, even if just from the
// case type and defendant name.
//
// Query params:
//   ?limit=200    cases per call (default 200, max 300)
//   ?offset=0     pagination cursor

import { kv } from "@vercel/kv";
import { KEYS } from "../src/lib/tcpaSchema.js";
import { KNOWN_SETTLEMENTS } from "../src/data/knownTcpaSettlements.js";
import { normalize as normalizeDefendant } from "../src/lib/defendantResolver.js";
import { rebuildSearchIndex } from "../src/lib/tcpaCaseStore.js";

const HAIKU = "claude-haiku-4-5-20251001";

// ── Seed index ────────────────────────────────────────────────────────────────

const seedIndex = (() => {
  const idx = {};
  for (const s of KNOWN_SETTLEMENTS) {
    const k = s.defendantNorm;
    idx[k] = idx[k] || [];
    idx[k].push(s);
  }
  return idx;
})();

function applySeed(record) {
  const defendants = (record.defendants || []).map(d => d.displayName);
  for (const name of defendants) {
    const norm = normalizeDefendant(name);
    const seeds = seedIndex[norm];
    if (!seeds) continue;
    // Pick seed whose caseType matches and filing date is plausible
    const seed = seeds.find(s => s.caseType === record.caseType) || seeds[0];
    if (!seed) continue;

    const s = { ...(record.settlement || {}) };
    let changed = false;

    if (!s.perClaimantRange  && seed.perClaimantRange)  { s.perClaimantRange  = seed.perClaimantRange;  changed = true; }
    if (!s.totalFund         && seed.totalFund)         { s.totalFund         = seed.totalFund;         changed = true; }
    if (!s.claimWindowCloses && seed.claimWindowCloses) { s.claimWindowCloses = seed.claimWindowCloses; changed = true; }
    if (!s.claimPortalUrl    && seed.claimPortalUrl)    { s.claimPortalUrl    = seed.claimPortalUrl;    changed = true; }
    if (!s.adminName         && seed.adminName)         { s.adminName         = seed.adminName;         changed = true; }
    if (!s.adminPhone        && seed.adminPhone)        { s.adminPhone        = seed.adminPhone;        changed = true; }
    if (!s.claimRequirements && seed.classDefinition)   { s.claimRequirements = seed.classDefinition;   changed = true; }

    let conductChanged = false;
    if (!record.conductDescription && seed.classDefinition) {
      record = { ...record, conductDescription: `${seed.caseType} violation — ${seed.classDefinition.slice(0, 120)}` };
      conductChanged = true;
    }

    if (changed || conductChanged) return { ...record, settlement: s };
  }
  return null;
}

// ── Conduct description fallback ──────────────────────────────────────────────
// Generate a minimal description from what we always have: case type + NOS code.

const NOS_DESCRIPTIONS = {
  "TCPA":       "Placed autodialed or prerecorded calls/texts to cellular phones without prior express written consent in violation of 47 U.S.C. § 227.",
  "FDCPA":      "Used false, deceptive, or abusive debt collection practices in violation of 15 U.S.C. § 1692.",
  "FCRA":       "Reported inaccurate consumer credit information or failed to investigate disputes in violation of 15 U.S.C. § 1681.",
  "TCPA+FDCPA": "Placed autodialed debt collection calls to cellular phones without consent, violating both the TCPA and FDCPA.",
  "CROA":       "Charged advance fees or misrepresented credit repair services in violation of 15 U.S.C. § 1679.",
  "CIPA":       "Used session-replay or wiretap technology on a financial website without consent in violation of California Penal Code § 631/632.",
  "FL_FTSA":    "Sent unsolicited telemarketing texts or calls in violation of Florida's Telephone Solicitation Act § 501.059.",
  "FCRA_FURNISHER": "Failed to correct inaccurate credit information after receiving a consumer dispute in violation of 15 U.S.C. § 1681s-2(b).",
  "ROSENTHAL":  "Used abusive or deceptive debt collection practices in violation of California's Rosenthal FDCPA § 1788.",
  "FCCPA":      "Used prohibited debt collection conduct in violation of Florida's Consumer Collection Practices Act § 559.55.",
  "ECOA":       "Failed to provide proper adverse action notices in violation of 15 U.S.C. § 1691.",
  "UDAAP":      "Engaged in unfair, deceptive, or abusive acts or practices in violation of the Dodd-Frank Act § 1031.",
  "GLBA":       "Failed to implement adequate safeguards to protect consumer financial information in violation of 15 U.S.C. § 6801.",
};

function fallbackConduct(record) {
  if (record.conductDescription && record.conductDescription.length > 20) return null;
  const defendants = (record.defendants || []).map(d => d.displayName).slice(0, 2).join(", ");
  const base = NOS_DESCRIPTIONS[record.caseType] || `Filed ${record.caseType} class action.`;
  return `${defendants ? defendants + ": " : ""}${base}`;
}

// ── Claude Haiku enrichment ───────────────────────────────────────────────────

async function callHaiku(messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: HAIKU, max_tokens: 600, messages }),
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

// Ask Claude about a batch of cases at once — more efficient than one-by-one.
// Returns a map of caseId → details object.
async function enrichBatch(records) {
  const items = records.map(c => ({
    id: c.id,
    caption: c.caption,
    defendants: (c.defendants || []).map(d => d.displayName).slice(0, 3).join(", "),
    type: c.caseType,
    court: c.court?.name || "",
    filed: c.filingDate || "",
  }));

  const prompt = `For each class action below, return what you know about the settlement from your training data. Return null for anything you're not confident about. Return ONLY a JSON array — one object per case in the same order.

Cases:
${JSON.stringify(items, null, 1)}

Return JSON array:
[
  {
    "id": "same id as input",
    "perClaimantRange": "$XX–$XX or null",
    "totalFund": "$X,XXX,XXX or null",
    "claimPortalUrl": "URL or null",
    "claimWindowCloses": "YYYY-MM-DD or null",
    "claimRequirements": "class definition or null",
    "adminName": "e.g. Kroll Settlement Administration or null",
    "adminPhone": "toll-free number or null",
    "adminEmail": "email or null",
    "adminWebsite": "URL or null"
  }
]`;

  try {
    const raw = await callHaiku([{ role: "user", content: prompt }]);
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return {};
    let arr;
    try { arr = JSON.parse(m[0]); } catch { return []; }
    if (!Array.isArray(arr)) return {};
    const out = {};
    for (const item of arr) { if (item && item.id) out[item.id] = item; }
    return out;
  } catch { return {}; }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const limit  = Math.min(parseInt(req.query?.limit  || "200"), 300);
  const offset = parseInt(req.query?.offset || "0");

  const allIds = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  const slice  = allIds.slice(offset, offset + limit);

  if (!slice.length) {
    return res.status(200).json({ ok: true, processed: 0, enriched: 0, total: allIds.length, done: true });
  }

  // Fetch all records in slice
  const FETCH = 50;
  const allRecords = [];
  for (let i = 0; i < slice.length; i += FETCH) {
    const batch = await Promise.all(slice.slice(i, i + FETCH).map(id => kv.get(KEYS.case(id)).catch(() => null)));
    for (const raw of batch) {
      if (!raw) continue;
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      allRecords.push(c);
    }
  }

  const toWrite = [];
  const needsClaude = [];

  for (let c of allRecords) {
    let updated = c;
    let changed = false;

    // 1. Apply seed data for known defendants
    const seeded = applySeed(c);
    if (seeded) { updated = seeded; changed = true; }

    // 2. Fill conduct description from NOS fallback
    const conduct = fallbackConduct(updated);
    if (conduct) { updated = { ...updated, conductDescription: conduct }; changed = true; }

    if (changed) toWrite.push(updated);

    // 3. Queue for Claude if still missing key fields after seed
    const stillMissing = !updated.settlement?.adminName && !updated.settlement?.perClaimantRange;
    if (stillMissing) needsClaude.push(updated);
  }

  // 4. Claude batch enrichment for cases seed didn't cover
  const CLAUDE_BATCH = 10;
  for (let i = 0; i < needsClaude.length; i += CLAUDE_BATCH) {
    const batch = needsClaude.slice(i, i + CLAUDE_BATCH);
    const results = await enrichBatch(batch).catch(() => ({}));
    for (const c of batch) {
      const details = results[c.id];
      if (!details) continue;
      const s = { ...(c.settlement || {}) };
      let changed = false;
      const fields = ["perClaimantRange", "totalFund", "claimPortalUrl", "claimWindowCloses",
                      "claimRequirements", "adminName", "adminPhone", "adminEmail", "adminWebsite"];
      for (const f of fields) {
        if (details[f] && !s[f]) { s[f] = details[f]; changed = true; }
      }
      if (changed) {
        const existing = toWrite.find(r => r.id === c.id);
        if (existing) { existing.settlement = s; }
        else { toWrite.push({ ...c, settlement: s }); }
      }
    }
  }

  // Write all updated records
  const WRITE = 50;
  for (let i = 0; i < toWrite.length; i += WRITE) {
    await Promise.all(
      toWrite.slice(i, i + WRITE).map(c => kv.set(KEYS.case(c.id), JSON.stringify(c), { ex: 365 * 24 * 3600 }))
    );
  }

  const hasMore = (offset + limit) < allIds.length;
  if (!hasMore) await rebuildSearchIndex().catch(() => {});

  return res.status(200).json({
    ok: true,
    processed: allRecords.length,
    enriched: toWrite.length,
    total: allIds.length,
    nextOffset: hasMore ? offset + limit : null,
    done: !hasMore,
  });
}
