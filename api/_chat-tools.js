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
  // ── Client / plaintiff tools ──────────────────────────────────────────────
  {
    name: "search_clients",
    description:
      "Find a plaintiff/client in the database by name, phone, email, or state. Returns up to 25 hits with id, name, " +
      "state, phone, email, partnerId, and a count of qualifying matched cases. Use this when the user names a person " +
      "('look up Mary Smith', 'find John Doe', 'who's our Capital One plaintiff in Florida').",
    input_schema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "First and/or last name (substring, case-insensitive)" },
        phone:   { type: "string", description: "Phone number — digits in any format" },
        email:   { type: "string", description: "Email (substring, case-insensitive)" },
        state:   { type: "string", description: "Two-letter state code, e.g. 'FL'" },
        partner: { type: "string", description: "Partner ID, e.g. 'credit_com'" },
        limit:   { type: "integer", description: "Max results (default 25, max 100)" },
      },
    },
  },
  {
    name: "get_client",
    description:
      "Fetch one client by their ID. Returns the full record: contact info, address history, collections history " +
      "(creditors / debt buyers / contact dates), partnerId, and retainer status. Use this after search_clients " +
      "when the user wants the profile, or to inspect the creditor history that drives matching.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Client ID, e.g. 'c_1778512586426_0_30bbe'" } },
      required: ["id"],
    },
  },
  {
    name: "get_client_matches",
    description:
      "For a single client, return every TCPA / FDCPA / FCRA case they qualify for, with per-match score, " +
      "qualifying/disqualifying factors, claim deadline, and an estimated dollar recovery range (floor / ceiling / " +
      "midpoint) per match plus a total. Reads the cached client_report snapshot when fresh (< 24h), recomputes " +
      "otherwise. THIS IS THE ANSWER to 'what is <plaintiff> eligible for' and 'how much could <plaintiff> recover'.",
    input_schema: {
      type: "object",
      properties: {
        id:    { type: "string", description: "Client ID" },
        fresh: { type: "boolean", description: "Force recomputation (skip cached snapshot). Default false." },
      },
      required: ["id"],
    },
  },
  {
    name: "estimate_client_recovery",
    description:
      "Return just the dollar summary for one client: total floor / ceiling / midpoint across all qualifying " +
      "matches, count of strong matches (score ≥ 75), claim windows closing in 30 days, and breakdown by case " +
      "type. Lighter than get_client_matches when the user only asks the money question.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Client ID" } },
      required: ["id"],
    },
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

  // ── Client / plaintiff tools ──────────────────────────────────────────────
  async search_clients({ name, phone, email, state, partner, limit = 25 }) {
    const max = Math.min(parseInt(limit) || 25, 100);

    // Pick a starting set of IDs: per-partner index if specified, else global.
    const seedIds = partner
      ? (await kv.zrange(`clients_by_partner:${partner}`, 0, -1, { rev: true }).catch(() => []))
      : (await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []));
    if (!seedIds?.length) return { total: 0, results: [] };

    const nameLower  = (name || "").toLowerCase().trim();
    const emailLower = (email || "").toLowerCase().trim();
    const phoneDigits = (phone || "").replace(/\D/g, "");
    const stateUp = (state || "").toUpperCase().slice(0, 2);

    const results = [];
    const BATCH = 200;
    let scanned = 0;
    for (let i = 0; i < seedIds.length && results.length < max && scanned < 5000; i += BATCH) {
      const slice = seedIds.slice(i, i + BATCH);
      const records = await Promise.all(slice.map((id) => kv.get(`client:${id}`)));
      for (const r of records) {
        scanned++;
        if (!r) continue;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        if (stateUp && c.state !== stateUp) continue;
        if (nameLower) {
          const full = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
          if (!full.includes(nameLower)) continue;
        }
        if (emailLower && !(c.email || "").toLowerCase().includes(emailLower)) continue;
        if (phoneDigits) {
          const digits = (c.phoneNumbers || [c.phone])
            .filter(Boolean)
            .map(p => String(p).replace(/\D/g, ""))
            .join(" ");
          if (!digits.includes(phoneDigits)) continue;
        }
        // Count cached matched cases (if any)
        let matchedCount = 0;
        try {
          matchedCount = (await kv.zcard(`tcpa:client_matches:${c.id}`).catch(() => 0)) || 0;
        } catch {}
        results.push({
          id: c.id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
          state: c.state,
          phone: c.phone,
          email: c.email,
          partnerId: c.partnerId || "manual",
          city: c.city,
          age: c.age,
          ingestSource: c.ingestSource,
          collectionsCount: (c.collectionsHistory || []).length,
          matchedCases: matchedCount,
          retainerStatus: c.retainerStatus || "Uncontacted",
        });
        if (results.length >= max) break;
      }
    }
    return { total: results.length, scanned, results };
  },

  async get_client({ id }) {
    if (!id) return { error: "id required" };
    const raw = await kv.get(`client:${id}`).catch(() => null);
    if (!raw) return { error: "client not found" };
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      id: c.id,
      name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
      firstName: c.firstName,
      lastName: c.lastName,
      state: c.state,
      city: c.city,
      phone: c.phone,
      phoneNumbers: c.phoneNumbers,
      email: c.email,
      dob: c.dob,
      age: c.age,
      partnerId: c.partnerId,
      ingestSource: c.ingestSource,
      sourceFirm: c.sourceFirm,
      retainerStatus: c.retainerStatus || "Uncontacted",
      tcpaOptOut: c.tcpaOptOut === true,
      addressHistory: c.addressHistory || [],
      // Trim collectionsHistory to creditor / debtBuyer / dateRange so the
      // tool result stays compact for the LLM.
      collectionsHistory: (c.collectionsHistory || []).map((e) => ({
        creditor: e.creditor || null,
        debtBuyer: e.debtBuyer || null,
        creditorCanonicalId: e.creditorCanonicalId || null,
        debtBuyerCanonicalId: e.debtBuyerCanonicalId || null,
        status: e.status || null,
        dateRange: e.dateRange || null,
        contactMethods: e.contactMethods || [],
        contactDatesCount: Array.isArray(e.contactDates) ? e.contactDates.length : 0,
      })),
      existingCases: c.existingCases || "",
      claimedSettlements: c.claimedSettlements || [],
    };
  },

  async get_client_matches({ id, fresh = false }) {
    if (!id) return { error: "id required" };
    // Reuse the same path as the HTTP endpoint
    let report = null;
    if (!fresh) {
      const cached = await kv.get(`tcpa:client_report:${id}`).catch(() => null);
      if (cached) {
        report = typeof cached === "string" ? JSON.parse(cached) : cached;
      }
    }
    if (!report) {
      // Trigger a fresh build via the client-report module (avoid HTTP self-call)
      const clientRaw = await kv.get(`client:${id}`).catch(() => null);
      if (!clientRaw) return { error: "client not found" };
      const client = typeof clientRaw === "string" ? JSON.parse(clientRaw) : clientRaw;
      const { generateClientReport } = await import("./client-report.js");
      report = await generateClientReport(client, { topN: 100 });
    }
    // Compact for the LLM — return one row per qualifying case
    return {
      clientId: id,
      clientName: report.client?.name,
      generatedAt: report.generatedAt,
      summary: report.summary,
      qualifyingMatches: (report.qualifyingCases || []).slice(0, 50).map((m) => ({
        caseId: m.caseId,
        caption: m.caption,
        caseType: m.caseType,
        defendants: m.defendants,
        court: m.court,
        status: m.status,
        score: m.score,
        qualifies: m.qualifies,
        claimWindowCloses: m.claimWindowCloses,
        daysToClaim: m.daysToClaim,
        matchingFactors: m.matchingFactors,
        disqualifyingFactors: m.disqualifyingFactors,
        recovery: m.estimate ? {
          floor: m.estimate.floor,
          ceiling: m.estimate.ceiling,
          midpoint: m.estimate.midpoint,
          method: m.estimate.method,
          violations: m.estimate.violations,
        } : null,
        // Filing guidance — what to prove, what to collect, where to file.
        // Stripped slightly for token budget; full text is in the HTML report.
        guidance: m.guidance ? {
          pathway: m.guidance.pathway,
          actionable: m.guidance.actionable,
          headline: m.guidance.headline,
          filingMechanism: m.guidance.filingMechanism,
          deadline: m.guidance.deadline,
          portalUrl: m.guidance.portalUrl,
          knownPerClaimant: m.guidance.knownPerClaimant,
          perViolationStatutory: m.guidance.perViolationStatutory,
          seedCitation: m.guidance.seedCitation,
          elementsToPlead: m.guidance.elementsToPlead?.slice(0, 6),
          documentsToCollect: m.guidance.documentsToCollect?.slice(0, 6),
          factualQuestionsForIntake: m.guidance.factualQuestionsForIntake?.slice(0, 5),
          redFlags: m.guidance.redFlags?.slice(0, 4),
          classDefinition: m.guidance.classDefinition,
          classPeriod: m.guidance.classPeriod,
        } : null,
      })),
      watchlistCount: report.watchlistCases?.length || 0,
      disqualifiedCount: report.disqualifiedCases?.length || 0,
    };
  },

  async estimate_client_recovery({ id }) {
    if (!id) return { error: "id required" };
    let report = null;
    const cached = await kv.get(`tcpa:client_report:${id}`).catch(() => null);
    if (cached) {
      report = typeof cached === "string" ? JSON.parse(cached) : cached;
    } else {
      const clientRaw = await kv.get(`client:${id}`).catch(() => null);
      if (!clientRaw) return { error: "client not found" };
      const client = typeof clientRaw === "string" ? JSON.parse(clientRaw) : clientRaw;
      const { generateClientReport } = await import("./client-report.js");
      report = await generateClientReport(client, { topN: 200 });
    }
    const s = report.summary || {};
    // Per-caseType totals
    const byCaseType = {};
    for (const m of (report.qualifyingCases || [])) {
      const t = m.caseType || "TCPA";
      byCaseType[t] = byCaseType[t] || { matches: 0, floor: 0, ceiling: 0 };
      byCaseType[t].matches += 1;
      byCaseType[t].floor   += m.estimate?.floor   || 0;
      byCaseType[t].ceiling += m.estimate?.ceiling || 0;
    }
    return {
      clientId: id,
      clientName: report.client?.name,
      qualifyingCases: s.qualifyingCases || 0,
      strongMatches: s.strongMatches || 0,
      claimWindowsClosingSoon: s.claimWindowsClosingSoon || 0,
      recovery: s.recovery, // { floor, ceiling, midpoint, formatted: {...} }
      byCaseType,
      // Top 5 individual matches for context
      topMatches: (report.qualifyingCases || []).slice(0, 5).map((m) => ({
        caption: m.caption,
        score: m.score,
        floor: m.estimate?.floor,
        ceiling: m.estimate?.ceiling,
        claimWindowCloses: m.claimWindowCloses,
        daysToClaim: m.daysToClaim,
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
