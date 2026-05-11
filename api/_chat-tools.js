// Tool definitions for the Platform Intelligence Chat. These let Claude
// query the live KV store to answer questions about real data — TCPA cases,
// defendants, leads, source health — instead of hallucinating from the
// static knowledge base alone.
//
// Each tool has a schema (Anthropic API format) and a server-side executor
// that reads from KV and returns a compact JSON result.

import { kv } from "@vercel/kv";
import { KEYS } from "../src/lib/tcpaSchema.js";

// ── Schemas (sent to Anthropic with the request) ────────────────────────────

export const TOOL_SCHEMAS = [
  {
    name: "get_platform_state",
    description:
      "Returns the current freshness rollup — counts of TCPA cases / leads / clients / defendants, " +
      "tracked settlement value, scan health, source health summary, top recent defendants, " +
      "trends (cases per week last 12 weeks), watchlist (closing-soon claim windows + high-priority leads). " +
      "Call this first when answering any question about 'how many', 'what's our biggest', 'is X up to date'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_cases",
    description:
      "Searches the TCPA / FDCPA / FCRA case database. Returns up to 25 matching cases with caption, " +
      "defendants, status, filing date, court, settlement fund. Use this when the user asks about specific " +
      "defendants, case types, statuses, or states.",
    input_schema: {
      type: "object",
      properties: {
        defendant: { type: "string", description: "Defendant name (partial match, case-insensitive)" },
        caseType:  { type: "string", enum: ["TCPA", "FDCPA", "FCRA", "TCPA+FDCPA"] },
        status:    { type: "string", enum: ["active", "settled", "claim_open", "claim_closed", "dismissed"] },
        state:     { type: "string", description: "Two-letter state code, e.g. 'CA'" },
        keyword:   { type: "string", description: "Substring search across caption / conduct" },
        limit:     { type: "integer", description: "Max results (default 25, max 100)" },
      },
    },
  },
  {
    name: "get_case",
    description: "Fetches one case by its ID. Returns full record including settlement, conduct, defendants, source URL.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Case ID, e.g. 'cl_73319173'" } },
      required: ["id"],
    },
  },
  {
    name: "search_defendants",
    description:
      "Find canonical defendant entities by name (substring match across all known aliases). " +
      "Returns defendantId, displayName, alias list, and case count. Use for questions like 'how many cases " +
      "involve Capital One', 'is Equifax a defendant on multiple cases'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Defendant name to search for (partial)" },
        limit: { type: "integer", description: "Max results (default 10)" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_defendant_cases",
    description: "List every case for a canonical defendant ID. Returns up to 50 cases, newest first.",
    input_schema: {
      type: "object",
      properties: { canonicalId: { type: "string" } },
      required: ["canonicalId"],
    },
  },
  {
    name: "search_leads",
    description:
      "Query the intelligence leads inbox. Returns up to 25 leads matching the filters with score, headline, " +
      "source, classification. Use this when the user asks about leads, signals, or news the platform picked up.",
    input_schema: {
      type: "object",
      properties: {
        minScore: { type: "integer", description: "Minimum score (0-100)" },
        keyword:  { type: "string", description: "Substring across title and analysis" },
        limit:    { type: "integer", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "get_source_health",
    description:
      "Returns the source-monitor's last probe results: which of our 38 external data sources are healthy " +
      "(green), degraded (yellow), down (red), or skipped (no API key). Includes HTTP status, latency, and " +
      "last-error per source. Use when the user asks 'why isn't X updating' or 'is the FDA feed working'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ── Executors (called server-side when Claude requests a tool) ──────────────

const ROLLUP_FRESHNESS = "agent:freshness:rollup";
const ROLLUP_SOURCES   = "agent:source-monitor:rollup";

async function readJson(key) {
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function fetchCasesByIds(ids, limit = 25) {
  const slice = ids.slice(0, limit);
  const records = await Promise.all(slice.map((id) => kv.get(KEYS.case(id))));
  return records
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));
}

function compactCase(c) {
  return {
    id: c.id,
    caption: c.caption,
    caseType: c.caseType,
    status: c.status,
    filingDate: c.filingDate,
    court: c.court?.name || c.court?.district || "",
    state: c.court?.state || "",
    docket: c.court?.docket || "",
    defendants: (c.defendants || []).map((d) => d.displayName),
    settlementFund: c.settlement?.totalFund || null,
    claimWindowCloses: c.settlement?.claimWindowCloses || null,
    source: c.source,
    sourceUrl: c.sourceUrl,
  };
}

const TOOLS = {
  async get_platform_state() {
    const rollup = await readJson(ROLLUP_FRESHNESS);
    if (!rollup) return { error: "freshness rollup not available — agent has not run yet" };
    // Strip extremely verbose sub-trees that aren't useful for the model.
    const { ranAt, durationMs, counts, lastUpdated, scanHealth, watchlist, trends } = rollup;
    return {
      ranAt, durationMs,
      counts,
      lastUpdated,
      scanHealth: {
        status: scanHealth?.status,
        lastScanAt: scanHealth?.lastScanAt,
        daysSince: scanHealth?.daysSince,
        runsLast7: scanHealth?.runsLast7,
        analysisQueueDepth: scanHealth?.analysisQueueDepth,
      },
      watchlist: {
        closingSoonCount: watchlist?.closingSoon?.length || 0,
        closingSoon: (watchlist?.closingSoon || []).slice(0, 10),
        highPriorityCount: watchlist?.highPriority?.length || 0,
        highPriority: (watchlist?.highPriority || []).slice(0, 5),
        staleSourcesCount: watchlist?.staleSources?.length || 0,
        staleSources: watchlist?.staleSources || [],
      },
      trends: {
        casesPerWeek: trends?.casesPerWeek?.slice(-8) || [],
        topNewDefendants: trends?.topNewDefendants?.slice(0, 5) || [],
      },
    };
  },

  async search_cases(input) {
    const limit = Math.min(input.limit || 25, 100);

    // Pick the most-selective index based on the filters provided.
    let candidateIds = [];
    if (input.defendant) {
      // Resolve to canonicalId via alias lookup; substring fallback if no exact match.
      const norm = input.defendant.toLowerCase().replace(/[.,&]/g, " ").replace(/\s+/g, " ").trim();
      const directHit = await kv.get(`tcpa:defendant_alias:${norm}`).catch(() => null);
      if (directHit) {
        candidateIds = await kv.zrange(KEYS.byDefendant(directHit), 0, -1, { rev: true }).catch(() => []);
      } else {
        // Substring scan over defendant index.
        const allDefIds = await kv.zrange("tcpa:defendants_index", 0, 199).catch(() => []);
        const records = await Promise.all(allDefIds.map((id) => kv.get(`tcpa:defendant:${id}`)));
        const matchedIds = [];
        records.forEach((r) => {
          if (!r) return;
          const d = typeof r === "string" ? JSON.parse(r) : r;
          const aliases = [d.displayName, ...(d.aliases || [])].join(" ").toLowerCase();
          if (aliases.includes(input.defendant.toLowerCase())) matchedIds.push(d.canonicalId);
        });
        const idArrays = await Promise.all(matchedIds.slice(0, 5).map((cId) =>
          kv.zrange(KEYS.byDefendant(cId), 0, -1, { rev: true }).catch(() => [])
        ));
        candidateIds = [...new Set(idArrays.flat())];
      }
    } else if (input.state) {
      candidateIds = await kv.zrange(KEYS.byState(input.state.toUpperCase()), 0, -1, { rev: true }).catch(() => []);
    } else if (input.status) {
      candidateIds = await kv.zrange(KEYS.byStatus(input.status), 0, -1, { rev: true }).catch(() => []);
    } else {
      candidateIds = await kv.zrange(KEYS.byFilingDate(), 0, 499, { rev: true }).catch(() => []);
    }

    // Apply secondary filters in-process.
    const cases = await fetchCasesByIds(candidateIds, Math.min(candidateIds.length, 200));
    const filtered = cases.filter((c) => {
      if (input.caseType && c.caseType !== input.caseType) return false;
      if (input.status && c.status !== input.status) return false;
      if (input.state) {
        const st = input.state.toUpperCase();
        if (c.court?.state !== st && !(c.eligibleStates || []).includes(st)) return false;
      }
      if (input.keyword) {
        const ql = input.keyword.toLowerCase();
        const hay = `${c.caption || ""} ${(c.defendants || []).map((d) => d.displayName).join(" ")} ${c.conductDescription || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });

    return {
      query: input,
      total: filtered.length,
      cases: filtered.slice(0, limit).map(compactCase),
      truncated: filtered.length > limit,
    };
  },

  async get_case(input) {
    const raw = await kv.get(KEYS.case(input.id));
    if (!raw) return { error: `case '${input.id}' not found` };
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { case: c };
  },

  async search_defendants(input) {
    const limit = input.limit || 10;
    const allIds = await kv.zrange("tcpa:defendants_index", 0, -1).catch(() => []);
    const records = await Promise.all(allIds.map((id) => kv.get(`tcpa:defendant:${id}`)));
    const q = input.name.toLowerCase();
    const matches = [];
    for (const r of records) {
      if (!r) continue;
      const d = typeof r === "string" ? JSON.parse(r) : r;
      const haystack = [d.displayName, ...(d.aliases || [])].join(" ").toLowerCase();
      if (haystack.includes(q)) matches.push(d);
    }
    // Attach case counts for top matches.
    const top = matches.slice(0, limit);
    const withCounts = await Promise.all(top.map(async (d) => ({
      canonicalId: d.canonicalId,
      displayName: d.displayName,
      aliases: d.aliases,
      caseCount: (await kv.zcard(KEYS.byDefendant(d.canonicalId)).catch(() => 0)) || 0,
    })));
    withCounts.sort((a, b) => b.caseCount - a.caseCount);
    return { query: input.name, total: matches.length, defendants: withCounts };
  },

  async get_defendant_cases(input) {
    const ids = await kv.zrange(KEYS.byDefendant(input.canonicalId), 0, 49, { rev: true }).catch(() => []);
    const cases = await fetchCasesByIds(ids, 50);
    return {
      canonicalId: input.canonicalId,
      total: cases.length,
      cases: cases.map(compactCase),
    };
  },

  async search_leads(input) {
    const limit = Math.min(input.limit || 25, 100);
    const minScore = input.minScore || 0;
    const ids = await kv.zrange("leads_by_score", minScore, "+inf", {
      byScore: true, rev: true, offset: 0, count: 200,
    }).catch(() => []);
    const records = await Promise.all(ids.slice(0, 200).map((id) => kv.get(`lead:${id}`)));
    const leads = records
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r));
    const filtered = input.keyword
      ? leads.filter((l) => {
          const a = l.analysis || {};
          const hay = `${a.headline || l.title || ""} ${a.summary || l.description || ""}`.toLowerCase();
          return hay.includes(input.keyword.toLowerCase());
        })
      : leads;
    return {
      query: input,
      total: filtered.length,
      leads: filtered.slice(0, limit).map((l) => ({
        id: l.id,
        title: l.title,
        headline: l.analysis?.headline,
        score: l.analysis?.score,
        classification: l.analysis?.joinOrCreate,
        category: l.category,
        source: l.source,
        defendant: l.analysis?.defendantProfile?.name,
        caseType: l.analysis?.caseType,
        urgency: l.analysis?.timeline?.urgencyLevel,
        url: l.url,
        scannedAt: l.scannedAt,
      })),
    };
  },

  async get_source_health() {
    const rollup = await readJson(ROLLUP_SOURCES);
    if (!rollup) return { error: "source-monitor rollup not available — agent has not run yet" };
    return {
      ranAt: rollup.ranAt,
      total: rollup.total,
      byHealth: rollup.byHealth,
      byCategory: rollup.byCategory,
      sources: (rollup.sources || []).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        health: s.health,
        httpStatus: s.httpStatus,
        latencyMs: s.latencyMs,
        error: s.error,
        reason: s.reason,
        lastIngestAt: s.lastIngestAt || null,
      })),
    };
  },
};

export async function executeTool(name, input) {
  const fn = TOOLS[name];
  if (!fn) return { error: `unknown tool '${name}'` };
  try {
    return await fn(input || {});
  } catch (e) {
    return { error: `tool '${name}' threw: ${e.message}` };
  }
}
