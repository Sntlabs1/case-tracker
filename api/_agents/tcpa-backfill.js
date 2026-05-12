// Historical CourtListener backfill agent — pulls TCPA / FDCPA / FCRA dockets
// from 2015-01-01 through the regular ingest's start (2021-01-01) one calendar
// month at a time, hourly, until done. Designed to live within CourtListener's
// 50 req/hr free-tier rate limit by staying small per run.
//
// Progress lives at `agent:tcpa-backfill:progress`:
//   {
//     currentMonth:    "2015-01",       // next month to fetch (YYYY-MM)
//     completedMonths: ["2015-01",...], // for visibility / dedup
//     totalCreated:    1234,            // running tally across all chunks
//     totalUpdated:    56,
//     status:          "running" | "done" | "rate_limited",
//     lastError:       "..." | null,
//     lastErrorAt:     ISO | null
//   }
//
// Once status === "done" the agent returns immediately on every subsequent run.
// To restart from the beginning: DELETE the progress key in KV.

import { kv } from "@vercel/kv";
import { fetchDockets } from "../_tcpa-sources/courtlistener.js";
import { importCases } from "../../src/lib/tcpaCaseStore.js";

const PROGRESS_KEY = "agent:tcpa-backfill:progress";

// Window: oldest realistic year (2015) → just before regular ingest's start (2021-01).
// The regular tcpa-ingest cron handles 2021-onwards. They never overlap.
const START_MONTH = "2015-01";
const END_MONTH   = "2021-01"; // exclusive — backfill stops the chunk BEFORE 2021-01

const MONTHS_PER_RUN = 1; // conservative: ~5-15 CL requests per run, well under 50/hr

const CASE_TYPES = ["TCPA", "FDCPA", "FCRA"];

function nextMonth(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthBounds(yyyymm) {
  return [`${yyyymm}-01`, `${nextMonth(yyyymm)}-01`];
}

function totalMonths() {
  // Inclusive count from START_MONTH up to (but not including) END_MONTH.
  let n = 0;
  let m = START_MONTH;
  while (m < END_MONTH) { n++; m = nextMonth(m); }
  return n;
}
const TOTAL_MONTHS = totalMonths(); // 72 months for 2015-01 → 2021-01

async function readProgress() {
  const raw = await kv.get(PROGRESS_KEY).catch(() => null);
  if (!raw) {
    return {
      currentMonth: START_MONTH,
      completedMonths: [],
      totalCreated: 0,
      totalUpdated: 0,
      status: "running",
      lastError: null,
      lastErrorAt: null,
    };
  }
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function writeProgress(p) {
  await kv.set(PROGRESS_KEY, JSON.stringify(p), { ex: 365 * 24 * 3600 });
}

async function processOneMonth(yyyymm) {
  const [since, until] = monthBounds(yyyymm);
  let created = 0, updated = 0, errors = 0, rateLimited = false;
  let configError = null;
  const errorMessages = [];

  for (const caseType of CASE_TYPES) {
    try {
      await fetchDockets({
        caseType,
        since,
        until,
        maxPages: 25, // a single month rarely exceeds 5-10 pages even at peak
        onBatch: async (records) => {
          const r = await importCases(records);
          created += r.created;
          updated += r.updated;
        },
      });
    } catch (e) {
      errors++;
      errorMessages.push(`${caseType}: ${e.message}`);
      if (e.message?.includes("CourtListener 429")) {
        rateLimited = true;
        break; // throttled — try same month next run
      }
      // Config errors (missing token) are unrecoverable — surface them and
      // bail so we don't silently advance the month past data that never got
      // fetched.
      if (e.message?.includes("COURTLISTENER_API_TOKEN not set")) {
        configError = "COURTLISTENER_API_TOKEN not set in environment";
        break;
      }
    }
  }

  return { created, updated, errors, rateLimited, configError, errorMessages };
}

export default {
  name: "tcpa-backfill",
  description:
    "One-shot historical CourtListener backfill from 2015-01 to 2021-01 (72 months). Processes 1 month per " +
    "hourly run for all 3 case types (TCPA + FDCPA + FCRA), respecting CourtListener's 50 req/hr free-tier " +
    "limit. Self-completes once the full window is covered (~3 days).",
  schedule: "45 * * * *", // hourly at :45 — staggered from regular ingest at :00

  async run() {
    const progress = await readProgress();

    if (progress.status === "done") {
      return {
        ok: true,
        summary: {
          status: "done",
          completedMonths: progress.completedMonths.length,
          totalCreated: progress.totalCreated,
          totalUpdated: progress.totalUpdated,
        },
      };
    }

    let chunkCreated = 0;
    let chunkUpdated = 0;
    const monthsThisRun = [];

    for (let i = 0; i < MONTHS_PER_RUN; i++) {
      if (progress.currentMonth >= END_MONTH) {
        progress.status = "done";
        break;
      }
      const month = progress.currentMonth;
      const result = await processOneMonth(month);

      if (result.rateLimited) {
        // Save state without advancing — try this month again next run.
        progress.lastError = "CourtListener 429 rate limit";
        progress.lastErrorAt = new Date().toISOString();
        progress.status = "rate_limited";
        await writeProgress(progress);
        return {
          ok: true,
          summary: {
            status: "rate_limited",
            stuckOnMonth: month,
            completedMonths: progress.completedMonths.length,
            remaining: TOTAL_MONTHS - progress.completedMonths.length,
            totalCreated: progress.totalCreated,
          },
        };
      }

      // Config error (e.g. missing token) — surface AND don't advance month.
      if (result.configError) {
        progress.lastError = result.configError;
        progress.lastErrorAt = new Date().toISOString();
        progress.status = "config_error";
        await writeProgress(progress);
        return {
          ok: false,
          summary: {
            status: "config_error",
            stuckOnMonth: month,
            configError: result.configError,
            completedMonths: progress.completedMonths.length,
            remaining: TOTAL_MONTHS - progress.completedMonths.length,
            totalCreated: progress.totalCreated,
          },
        };
      }

      // If every case type errored for any other reason, don't blindly advance
      // — bail and retry next hour so we don't skip months silently.
      if (result.errors >= CASE_TYPES.length && result.created === 0 && result.updated === 0) {
        progress.lastError = `all case types errored: ${(result.errorMessages || []).join(" | ").slice(0, 300)}`;
        progress.lastErrorAt = new Date().toISOString();
        progress.status = "errored";
        await writeProgress(progress);
        return {
          ok: false,
          summary: {
            status: "errored",
            stuckOnMonth: month,
            error: progress.lastError,
            completedMonths: progress.completedMonths.length,
            remaining: TOTAL_MONTHS - progress.completedMonths.length,
            totalCreated: progress.totalCreated,
          },
        };
      }

      // Success — advance.
      progress.completedMonths.push(month);
      progress.totalCreated += result.created;
      progress.totalUpdated += result.updated;
      progress.currentMonth = nextMonth(month);
      progress.status = "running";
      progress.lastError = null;
      progress.lastErrorAt = null;
      monthsThisRun.push(month);
      chunkCreated += result.created;
      chunkUpdated += result.updated;
    }

    if (progress.currentMonth >= END_MONTH) progress.status = "done";

    await writeProgress(progress);

    return {
      ok: true,
      summary: {
        status: progress.status,
        monthsThisRun,
        chunkCreated,
        chunkUpdated,
        completedMonths: progress.completedMonths.length,
        remaining: TOTAL_MONTHS - progress.completedMonths.length,
        totalCreated: progress.totalCreated,
        totalUpdated: progress.totalUpdated,
        nextMonth: progress.currentMonth,
      },
    };
  },
};
