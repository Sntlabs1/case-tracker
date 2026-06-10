// Plaintiff-backfill agent — populates the per-plaintiff inverted index for
// cases ingested before the parser existed. Walks tcpa:cases_by_filing_date,
// derives plaintiffs from the caption via parsePlaintiffsFromCaption(), and
// writes:
//
//   tcpa:cases_by_plaintiff:${normalized}   (sorted set of caseIds)
//   tcpa:plaintiffs_index                   (sorted set, score = case count)
//
// Also persists the parsed plaintiffs back onto the case record so future
// reads return them without re-parsing. Idempotent — uses a per-case
// checkpoint flag so re-running only processes cases that don't yet carry
// plaintiffs[] on their record.
//
// Per-run cap: 1000 cases. The first full backfill across the seed corpus
// (~7K cases) needs 7+ runs OR a manual cap override.

import { kv } from "@vercel/kv";
import { KEYS } from "../../src/lib/ingest/tcpaSchema.js";
import {
  parsePlaintiffsFromCaption,
  normalizePlaintiff,
} from "../../src/lib/ingest/tcpaIngestNormalize.js";

const DEFAULT_MAX = 1000;

export default {
  name: "plaintiff-backfill",
  description:
    "Walks every TCPA / FDCPA / FCRA case and parses plaintiff name(s) from " +
    "the caption. Writes the per-plaintiff inverted index and persists the " +
    "parsed names onto each case record so repeat-player plaintiffs become " +
    "searchable. Idempotent.",
  schedule: "45 6 * * *", // daily at 06:45 (after tcpa-ingest at 06:00)

  async run({ max = DEFAULT_MAX } = {}) {
    const startedAt = Date.now();
    const ids = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
    if (!ids.length) {
      return { ok: true, summary: { processed: 0, indexed: 0, skipped: 0, note: "no cases" } };
    }

    let processed = 0;
    let indexed = 0;
    let skipped = 0;
    let withPlaintiffs = 0;
    let errors = 0;

    const BATCH = 100;
    for (let i = 0; i < ids.length && processed < max; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const records = await Promise.all(slice.map((id) => kv.get(KEYS.case(id))));

      for (let j = 0; j < records.length && processed < max; j++) {
        const raw = records[j];
        if (!raw) { skipped++; continue; }
        const c = typeof raw === "string" ? JSON.parse(raw) : raw;
        // Skip if already backfilled (plaintiffs field exists and is non-empty,
        // OR explicitly marked as parsed even when empty)
        if (Array.isArray(c.plaintiffs) && c.plaintiffs.length > 0) { skipped++; continue; }
        if (c.plaintiffsParsed === true) { skipped++; continue; }

        processed++;
        try {
          const plaintiffs = parsePlaintiffsFromCaption(c.caption || "");
          // Persist back onto the record — mark as parsed even if empty so
          // we don't re-attempt every run.
          const updated = { ...c, plaintiffs, plaintiffsParsed: true };
          await kv.set(KEYS.case(c.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 });

          if (plaintiffs.length) {
            withPlaintiffs++;
            indexed += plaintiffs.length;
            // Build all index writes in parallel per record
            const ops = [];
            for (const p of plaintiffs) {
              const norm = normalizePlaintiff(p);
              if (!norm) continue;
              const score = Date.parse(c.filingDate || c.ingestedAt || "") || Date.now();
              ops.push(kv.zadd(KEYS.byPlaintiff(norm), { score, member: c.id }));
              ops.push(kv.zincrby(KEYS.plaintiffIndex(), 1, norm));
            }
            await Promise.all(ops).catch(() => {});
          }
        } catch (e) {
          errors++;
        }
      }
    }

    return {
      ok: true,
      summary: {
        processed,
        withPlaintiffs,
        emptyParse: processed - withPlaintiffs,
        indexed,
        skipped,
        errors,
        totalCases: ids.length,
        remaining: Math.max(0, ids.length - skipped - processed),
      },
      result: {
        durationMs: Date.now() - startedAt,
      },
    };
  },
};
