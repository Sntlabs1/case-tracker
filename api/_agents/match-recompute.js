// Match-recompute agent — drains both the case-pending and client-pending
// queues, recomputing TCPA rules-based match scores. High-confidence matches
// (score ≥ 80 + qualifies=true) automatically surface in the Pending Outreach
// inbox via the match-batch hook.
//
// Schedule: hourly at :05 (staggered from other agents).
// Per-run cap: 20 clients + 20 cases ≈ 5-10s.

import { kv } from "@vercel/kv";
import {
  drainPendingClients,
  drainPendingCases,
} from "../match-batch.js";

const MAX_CLIENTS_PER_RUN = 20;
const MAX_CASES_PER_RUN   = 20;
const THRESHOLD = 50;
const TOP_N     = 50;

export default {
  name: "match-recompute",
  description:
    "Drains the client-pending and case-pending match queues. For each, runs " +
    "the TCPA rules-based scorer against the opposite side of the database and " +
    "persists matches. Any score ≥ 80 with qualifies=true is queued for human " +
    "review in the Pending Outreach inbox.",
  schedule: "5 * * * *", // hourly at :05

  async run() {
    const startedAt = Date.now();

    const clientsResult = await drainPendingClients({
      threshold: THRESHOLD,
      topN: TOP_N,
      max: MAX_CLIENTS_PER_RUN,
    });

    const casesResult = await drainPendingCases({
      threshold: THRESHOLD,
      max: MAX_CASES_PER_RUN,
    });

    const clientOutreachQueued = (clientsResult.results || []).reduce(
      (acc, r) => acc + (r.outreachQueued || 0),
      0
    );
    const caseOutreachQueued = (casesResult.results || []).reduce(
      (acc, r) => acc + (r.outreachQueued || 0),
      0
    );

    // Surface current queue depths for the Agents tab summary.
    const remainingClients = (await kv.zcard("tcpa:clients_pending_match").catch(() => 0)) || 0;
    const remainingCases   = (await kv.llen("tcpa:cases_pending_match").catch(() => 0)) || 0;
    const outreachDepth    = (await kv.zcard("outreach:pending").catch(() => 0)) || 0;

    return {
      ok: true,
      summary: {
        clientsDrained:        clientsResult.drained || 0,
        casesDrained:          casesResult.drained || 0,
        outreachQueued:        clientOutreachQueued + caseOutreachQueued,
        clientsQueueRemaining: remainingClients,
        casesQueueRemaining:   remainingCases,
        outreachPendingDepth:  outreachDepth,
      },
      result: {
        durationMs: Date.now() - startedAt,
        clientsResult,
        casesResult,
      },
    };
  },
};
