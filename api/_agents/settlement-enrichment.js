// Settlement-enrichment agent — populates per-claimant amounts, total fund,
// final approval dates, and class definitions on cases that match our
// hand-curated KNOWN_SETTLEMENTS seed.
//
// Why this matters: the per-client recovery estimator falls back to the
// statutory floor ($500-$1500/violation TCPA) when settlement.perClaimantRange
// is null. For famous settlements where the actual per-claimant amount is
// public knowledge (Capital One ~$34/call, Caribbean Cruise ~$500/call), we
// can do far better than statutory minimums — these settlements paid out
// ABOVE the floor and our reports should reflect that.
//
// Strategy:
//   1. Walk every case in tcpa:cases_by_filing_date.
//   2. For each case's defendants, normalize the displayName and check
//      against the KNOWN_SETTLEMENTS index.
//   3. If a defendant hit is found and the case status is settled or
//      claim_open / claim_closed (or simply matches the case type), apply
//      the seed values — but only fill fields that are currently empty,
//      so machine-derived enrichment from other sources (eg case-tracker
//      web search results) wins when present.
//   4. Re-index status if it changes (e.g. active → settled).
//
// Idempotent. Safe to re-run. Logs counts per run for the Agents tab.

import { kv } from "@vercel/kv";
import { KEYS, CASE_STATUSES } from "../../src/lib/ingest/tcpaSchema.js";
import { normalize as normalizeDefendant } from "../../src/lib/ingest/defendantResolver.js";
import { KNOWN_SETTLEMENTS } from "../../src/data/knownTcpaSettlements.js";

const DEFAULT_MAX = 10000; // cover the whole DB in one pass; the work is cheap
const REPORT_INVALIDATE = "tcpa:client_report:";

function buildSeedIndex() {
  // Key by normalized defendant; allow multiple settlements per defendant
  // (DISH appears twice). When matching a case we'll prefer the one whose
  // caseType matches the case.
  const idx = {};
  for (const s of KNOWN_SETTLEMENTS) {
    const k = s.defendantNorm;
    idx[k] = idx[k] || [];
    idx[k].push(s);
  }
  return idx;
}

function pickBestSeed(seeds, caseRecord) {
  if (!seeds || !seeds.length) return null;
  // A seed should ONLY apply to a case where the filingDate is plausibly
  // contemporary with the famous settlement — i.e. filed during or shortly
  // after the class period, and not years after final approval. Otherwise
  // we're tagging unrelated cases (a new 2024 Capital One TCPA suit isn't
  // the 2015 Capital One MDL just because the defendant matches).
  const caseFiledMs = caseRecord.filingDate ? Date.parse(caseRecord.filingDate) : null;
  const candidates = seeds.filter((s) => {
    if (!caseFiledMs) return true; // unknown filing — don't filter
    const periodStart = s.classPeriod?.start ? Date.parse(s.classPeriod.start) : null;
    const finalApproval = s.finalApprovalDate ? Date.parse(s.finalApprovalDate) : null;
    // Case must not be filed earlier than the class period start (minus 1y slack)
    if (periodStart && caseFiledMs < periodStart - 365 * 24 * 3600 * 1000) return false;
    // Case must not be filed more than 4y after final approval (it's a different lawsuit)
    if (finalApproval && caseFiledMs > finalApproval + 4 * 365 * 24 * 3600 * 1000) return false;
    return true;
  });
  if (!candidates.length) return null;
  // Prefer caseType match among the time-compatible candidates
  const sameType = candidates.find((s) => s.caseType === caseRecord.caseType);
  return sameType || candidates[0];
}

function applySeed(caseRecord, seed) {
  const updated = JSON.parse(JSON.stringify(caseRecord));
  let changed = false;
  const fields = [];

  updated.settlement = updated.settlement || {};
  if (!updated.settlement.totalFund && seed.totalFund) {
    updated.settlement.totalFund = seed.totalFund;
    fields.push("totalFund");
    changed = true;
  }
  if (!updated.settlement.perClaimantRange && seed.perClaimantRange) {
    updated.settlement.perClaimantRange = seed.perClaimantRange;
    fields.push("perClaimantRange");
    changed = true;
  }
  if (!updated.settlement.finalApprovalDate && seed.finalApprovalDate) {
    updated.settlement.finalApprovalDate = seed.finalApprovalDate;
    fields.push("finalApprovalDate");
    changed = true;
  }
  if (!updated.classDefinition && seed.classDefinition) {
    updated.classDefinition = seed.classDefinition;
    fields.push("classDefinition");
    changed = true;
  }
  if (!updated.classPeriod?.start && seed.classPeriod?.start) {
    updated.classPeriod = updated.classPeriod || {};
    updated.classPeriod.start = seed.classPeriod.start;
    fields.push("classPeriod.start");
    changed = true;
  }
  if (!updated.classPeriod?.end && seed.classPeriod?.end) {
    updated.classPeriod = updated.classPeriod || {};
    updated.classPeriod.end = seed.classPeriod.end;
    fields.push("classPeriod.end");
    changed = true;
  }
  if (seed.geographicScope && (!updated.geographicScope || updated.geographicScope === "nationwide")) {
    updated.geographicScope = seed.geographicScope;
  }
  if (!updated.sourceUrl && seed.source) {
    updated.sourceUrl = ""; // leave URL alone; source is descriptive
    if (!updated.citations) updated.citations = [];
    if (!updated.citations.includes(seed.source)) {
      updated.citations.push(seed.source);
      fields.push("citation");
      changed = true;
    }
  }

  // Status: a case that now has finalApprovalDate populated is at minimum
  // "settled". Don't downgrade an existing "claim_open" or "claim_closed".
  if (updated.settlement?.finalApprovalDate &&
      updated.status === "active" &&
      CASE_STATUSES.includes("settled")) {
    updated.status = "settled";
    fields.push("status=settled");
    changed = true;
  }

  updated.lastVerifiedAt = new Date().toISOString();
  return { updated, changed, fields };
}

export default {
  name: "settlement-enrichment",
  description:
    "Walks every TCPA / FDCPA / FCRA case and applies the hand-curated " +
    "KNOWN_SETTLEMENTS seed to cases whose defendants match. Populates " +
    "per-claimant amount, total fund, final approval date, class period, " +
    "and class definition — only fills fields that are currently empty so " +
    "machine-enrichment from other sources is preserved. Idempotent.",
  schedule: "10 5 * * *", // daily at 05:10 UTC (after tcpa-ingest)

  async run({ max = DEFAULT_MAX } = {}) {
    const startedAt = Date.now();
    const seedIndex = buildSeedIndex();
    const knownKeys = Object.keys(seedIndex);

    const ids = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
    if (!ids?.length) {
      return { ok: true, summary: { processed: 0, updated: 0, note: "no cases" }, result: { durationMs: Date.now() - startedAt } };
    }

    let processed = 0;
    let updated = 0;
    let statusFlipsToSettled = 0;
    const examples = []; // first ~10 enrichments for visibility
    const seedHits = {}; // seedKey → count of cases hit

    const BATCH = 100;
    for (let i = 0; i < ids.length && processed < max; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const records = await Promise.all(slice.map((id) => kv.get(KEYS.case(id))));
      for (const raw of records) {
        if (!raw) continue;
        processed++;
        const c = typeof raw === "string" ? JSON.parse(raw) : raw;

        // Quick filter: any defendant match a known key?
        let seed = null;
        for (const d of (c.defendants || [])) {
          const norm = normalizeDefendant(d.displayName || "");
          if (!norm) continue;
          for (const k of knownKeys) {
            if (norm === k || norm.includes(k) || k.includes(norm)) {
              seed = pickBestSeed(seedIndex[k], c);
              if (seed) { seedHits[k] = (seedHits[k] || 0) + 1; break; }
            }
          }
          if (seed) break;
        }
        if (!seed) continue;

        const { updated: rec, changed, fields } = applySeed(c, seed);
        if (!changed) continue;
        try {
          await kv.set(KEYS.case(c.id), JSON.stringify(rec), { ex: 365 * 24 * 3600 });
          if (rec.status !== c.status && rec.status === "settled") {
            statusFlipsToSettled++;
            await kv.zrem(KEYS.byStatus(c.status), c.id).catch(() => {});
            await kv.zadd(KEYS.byStatus("settled"), { score: Date.now(), member: c.id }).catch(() => {});
            if (rec.settlement?.finalApprovalDate) {
              const ts = Date.parse(rec.settlement.finalApprovalDate) || Date.now();
              await kv.zadd(KEYS.bySettlementDate(), { score: ts, member: c.id }).catch(() => {});
            }
          }
          updated++;
          if (examples.length < 10) {
            examples.push({
              caseId: c.id,
              caption: c.caption?.slice(0, 80),
              defendant: c.defendants?.[0]?.displayName,
              fieldsSet: fields,
              perClaimantRange: rec.settlement.perClaimantRange,
              totalFund: rec.settlement.totalFund,
            });
          }
        } catch (e) {
          // skip
        }
      }
    }

    // Invalidate all cached portfolio + client reports so they re-render
    // with the new dollar amounts. (We don't enumerate per-client reports
    // here — they'll regen on next read; the portfolio cache is a single key.)
    await kv.del("tcpa:portfolio_report:all").catch(() => {});
    await kv.del("tcpa:portfolio_report:credit_com").catch(() => {});

    return {
      ok: true,
      summary: {
        processed,
        updated,
        statusFlipsToSettled,
        knownDefendantsCovered: knownKeys.length,
        seedHits,
      },
      result: {
        durationMs: Date.now() - startedAt,
        examples,
      },
    };
  },
};
