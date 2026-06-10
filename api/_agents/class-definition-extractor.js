// Class-definition extractor — Haiku pass over Westlaw-sourced cases to fill
// in classPeriod, classDefinition, and (where derivable) eligibleStates from
// the rich editor summaries the Westlaw exports carry.
//
// Why: Our matcher's +15 "residency period overlaps class period" signal
// never fires on Westlaw cases today because classPeriod is null. The
// summaries DO carry the period ("Plaintiffs allege defendant placed
// unwanted calls between June 2018 and March 2021…") — we just don't
// parse them.
//
// What it does, per eligible case:
//   1. Skip if classDefinition already populated AND classPeriod.start set
//      (already enriched, by this agent or settlement-enrichment).
//   2. Skip non-Westlaw cases — CourtListener dockets have terse text
//      that doesn't reveal class definitions reliably.
//   3. Send caption + caseType + conductDescription to Haiku, ask for a
//      tight structured extraction.
//   4. Persist the parsed fields back onto the case record.
//   5. If new classPeriod end-date is in the past + status is "active",
//      we leave status alone (the case-tracker agent owns status flips).
//
// Cost / time: ~4,000 Westlaw cases × $0.005 per Haiku call ≈ $20 total
// for a full pass. Batch 5 cases per call to amortize the prompt.
//
// Per-run cap default 300 cases; run with ?max=10000 to drain the whole
// backlog in one shot (~7–10 minutes wall clock).

import { kv } from "@vercel/kv";
import { KEYS } from "../../src/lib/ingest/tcpaSchema.js";

const HAIKU = "claude-haiku-4-5-20251001";
const DEFAULT_MAX = 300;
const BATCH = 5;
const CONCURRENCY = 4;

async function claudeJSON(messages, system, { maxTokens = 1500 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: HAIKU, max_tokens: maxTokens, system, messages }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    const text = (d.content || []).map((b) => b.text || "").filter(Boolean).join("");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const EXTRACTION_PROMPT = `You are extracting class-action structural facts from court opinion summaries.

Given an array of TCPA / FDCPA / FCRA cases (each with id, caption, caseType, and summary), return a JSON ARRAY of one object per case in the SAME ORDER:
[
  {
    "id": "<echo input id>",
    "classDefinition": "<one-sentence class definition phrased neutrally, e.g. 'Persons in California who received prerecorded marketing calls from defendant between Jan 2019 and Jun 2021.'>",
    "classPeriodStart": "<YYYY-MM-DD if extractable from summary, else null>",
    "classPeriodEnd":   "<YYYY-MM-DD if extractable, else null>",
    "eligibleStates":   ["<two-letter state codes if case is geographically restricted; empty array for nationwide>"],
    "geographicScope":  "<'nationwide' | 'single-state' | 'multi-state' | 'unknown'>",
    "conductCategory":  "<'autodialer' | 'prerecorded' | 'robotext' | 'junk_fax' | 'dnc_violation' | 'revoked_consent' | 'debt_collection' | 'credit_report' | 'other'>",
    "confidence":       <0-100 integer — how confident the extraction is given the summary>
  }
]

Rules:
- If the summary doesn't contain enough information for a field, set it to null (or [] for arrays) — do NOT guess.
- classDefinition must be one sentence, factual, no commentary.
- Periods: prefer specific YYYY-MM-DD where the summary names them. Use first-of-month approximations when only "January 2019" is given.
- Skip if the summary is empty or nonsense — set classDefinition to null and confidence to 0.
- Return ONLY the JSON array, no other text.`;

function isEnriched(c) {
  return !!(c.classDefinition && c.classDefinition.length > 10 &&
            (c.classPeriod?.start || c.classPeriod?.end));
}

function applyExtraction(c, ext) {
  if (!ext) return null;
  const updated = JSON.parse(JSON.stringify(c));
  let changed = false;
  if (!updated.classDefinition && ext.classDefinition && ext.confidence >= 50) {
    updated.classDefinition = ext.classDefinition;
    changed = true;
  }
  updated.classPeriod = updated.classPeriod || {};
  if (!updated.classPeriod.start && ext.classPeriodStart) {
    updated.classPeriod.start = ext.classPeriodStart;
    changed = true;
  }
  if (!updated.classPeriod.end && ext.classPeriodEnd) {
    updated.classPeriod.end = ext.classPeriodEnd;
    changed = true;
  }
  if (Array.isArray(ext.eligibleStates) && ext.eligibleStates.length &&
      (!updated.eligibleStates || updated.eligibleStates.length === 0)) {
    updated.eligibleStates = ext.eligibleStates.map((s) => String(s).toUpperCase().slice(0, 2));
    changed = true;
  }
  if (!updated.geographicScope && ext.geographicScope && ext.geographicScope !== "unknown") {
    updated.geographicScope = ext.geographicScope;
    changed = true;
  }
  if (changed) {
    updated.classDefinitionConfidence = ext.confidence;
    updated.classDefinitionExtractedAt = new Date().toISOString();
    updated.lastVerifiedAt = new Date().toISOString();
  }
  return changed ? updated : null;
}

export default {
  name: "class-definition-extractor",
  description:
    "Backfills classDefinition, classPeriod (start/end), eligibleStates, and " +
    "conductCategory on Westlaw-sourced cases using Haiku over the editor " +
    "summaries the Westlaw exports carry. Populates the +15 'class-period " +
    "overlap' matcher signal that otherwise never fires for the backbone " +
    "case database. Idempotent; skips already-enriched records.",
  schedule: "20 5 * * *", // daily at 05:20 UTC (after settlement-enrichment)

  async run({ max = DEFAULT_MAX } = {}) {
    const startedAt = Date.now();
    const ids = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
    if (!ids?.length) {
      return { ok: true, summary: { processed: 0, enriched: 0, note: "no cases" }, result: { durationMs: Date.now() - startedAt } };
    }

    // Find eligible cases (Westlaw + missing class definition or period)
    const eligible = [];
    const SCAN_BATCH = 100;
    for (let i = 0; i < ids.length && eligible.length < max; i += SCAN_BATCH) {
      const slice = ids.slice(i, i + SCAN_BATCH);
      const records = await Promise.all(slice.map((id) => kv.get(KEYS.case(id))));
      for (const raw of records) {
        if (!raw) continue;
        const c = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (c.source !== "westlaw") continue;
        if (isEnriched(c)) continue;
        if (!c.conductDescription || c.conductDescription.length < 80) continue;
        eligible.push(c);
        if (eligible.length >= max) break;
      }
    }

    if (!eligible.length) {
      return {
        ok: true,
        summary: { processed: 0, enriched: 0, note: "no eligible Westlaw cases need enrichment" },
        result: { durationMs: Date.now() - startedAt },
      };
    }

    // Batch + concurrent Haiku calls
    const batches = [];
    for (let i = 0; i < eligible.length; i += BATCH) batches.push(eligible.slice(i, i + BATCH));

    let enriched = 0;
    let lowConfidence = 0;
    let errors = 0;
    const examples = [];

    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(wave.map(async (batch) => {
        const items = batch.map((c) => ({
          id: c.id,
          caption: c.caption,
          caseType: c.caseType,
          summary: (c.conductDescription || "").slice(0, 1500),
        }));
        const out = await claudeJSON(
          [{ role: "user", content: `Cases to extract:\n${JSON.stringify(items, null, 1)}\n\nReturn JSON array as specified.` }],
          EXTRACTION_PROMPT,
          { maxTokens: 1800 }
        );
        return { batch, out };
      }));

      // Apply
      for (const { batch, out } of results) {
        if (!Array.isArray(out)) { errors += batch.length; continue; }
        const byId = Object.fromEntries(out.map((x) => [x.id, x]));
        for (const c of batch) {
          const ext = byId[c.id];
          if (!ext) { errors++; continue; }
          if ((ext.confidence ?? 0) < 50) { lowConfidence++; continue; }
          const updated = applyExtraction(c, ext);
          if (!updated) continue;
          try {
            await kv.set(KEYS.case(c.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 });
            enriched++;
            if (examples.length < 10) {
              examples.push({
                caseId: c.id,
                caption: c.caption?.slice(0, 80),
                classDefinition: ext.classDefinition?.slice(0, 120),
                classPeriod: { start: ext.classPeriodStart, end: ext.classPeriodEnd },
                eligibleStates: ext.eligibleStates,
                confidence: ext.confidence,
              });
            }
          } catch {
            errors++;
          }
        }
      }
    }

    // Bust cached reports so re-renders pick up the new +15 signal
    await kv.del("tcpa:portfolio_report:all").catch(() => {});
    await kv.del("tcpa:portfolio_report:credit_com").catch(() => {});

    return {
      ok: true,
      summary: {
        processed: eligible.length,
        enriched,
        lowConfidence,
        errors,
        remainingWestlawBacklog: Math.max(0, ids.length - eligible.length - enriched),
      },
      result: {
        durationMs: Date.now() - startedAt,
        examples,
      },
    };
  },
};
