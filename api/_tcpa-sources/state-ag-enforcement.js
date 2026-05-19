// State Attorney General TCPA / robocall enforcement.
//
// 25 state AGs actively bring TCPA / robocall / do-not-call enforcement actions.
// Each action names a company, describes the violation, and often leads to a
// consent decree or settlement that supports private class actions.
//
// Strategy: Google News RSS per state AG + TCPA keywords.
// Haiku extracts: company name, violation type, state, fine/restitution amount,
// settlement date, case description.
//
// Rate limit: one RSS fetch per state, 25 states = 25 HTTP calls per run.
// Haiku only called for articles that pass a keyword filter (~20% hit rate).

import { kv } from "@vercel/kv";
import Parser from "rss-parser";
import { importCases } from "../../src/lib/tcpaCaseStore.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
async function callHaiku(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  return (await res.json()).content?.[0]?.text || "";
}
const rssParser = new Parser({ timeout: 12000 });

// ── State AG definitions ──────────────────────────────────────────────────────

const STATE_AGS = [
  { state: "CA", name: "California AG", query: "California+attorney+general+TCPA+OR+robocall+OR+telemarketing+enforcement" },
  { state: "NY", name: "New York AG",   query: "New+York+attorney+general+TCPA+OR+robocall+OR+telemarketing+enforcement" },
  { state: "TX", name: "Texas AG",      query: "Texas+attorney+general+TCPA+OR+robocall+OR+telemarketing+enforcement" },
  { state: "FL", name: "Florida AG",    query: "Florida+attorney+general+TCPA+OR+robocall+OR+telemarketing+enforcement" },
  { state: "IL", name: "Illinois AG",   query: "Illinois+attorney+general+TCPA+OR+robocall+OR+telemarketing+enforcement" },
  { state: "PA", name: "Pennsylvania AG",query:"Pennsylvania+attorney+general+robocall+OR+telemarketing+enforcement" },
  { state: "OH", name: "Ohio AG",       query: "Ohio+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "NC", name: "North Carolina AG",query:"North+Carolina+attorney+general+robocall+OR+TCPA+enforcement" },
  { state: "MI", name: "Michigan AG",   query: "Michigan+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "WA", name: "Washington AG", query: "Washington+state+attorney+general+robocall+OR+TCPA+enforcement" },
  { state: "AZ", name: "Arizona AG",    query: "Arizona+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "CO", name: "Colorado AG",   query: "Colorado+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "MN", name: "Minnesota AG",  query: "Minnesota+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "MO", name: "Missouri AG",   query: "Missouri+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "MA", name: "Massachusetts AG",query:"Massachusetts+attorney+general+robocall+OR+TCPA+OR+telemarketing" },
  { state: "VA", name: "Virginia AG",   query: "Virginia+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "NJ", name: "New Jersey AG", query: "New+Jersey+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "MD", name: "Maryland AG",   query: "Maryland+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "IN", name: "Indiana AG",    query: "Indiana+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "TN", name: "Tennessee AG",  query: "Tennessee+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "WI", name: "Wisconsin AG",  query: "Wisconsin+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "GA", name: "Georgia AG",    query: "Georgia+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "KY", name: "Kentucky AG",   query: "Kentucky+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "OR", name: "Oregon AG",     query: "Oregon+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  { state: "NV", name: "Nevada AG",     query: "Nevada+attorney+general+robocall+OR+TCPA+OR+telemarketing+enforcement" },
  // Multistate coalitions (AG coordinated actions)
  { state: null, name: "Multistate AG Coalition", query: "multistate+attorney+general+coalition+robocall+OR+TCPA+enforcement" },
  { state: null, name: "FTC + State AGs",          query: "FTC+state+attorney+general+robocall+telemarketing+settlement+2024+OR+2025+OR+2026" },
];

function feedUrl(query) {
  return `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

// ── Haiku extraction ──────────────────────────────────────────────────────────

const PROMPT = `You are extracting state attorney general enforcement actions for a TCPA plaintiff litigation platform.

From this news article, extract every enforcement action by a state AG (or the FTC with state AGs) against a company for TCPA / robocall / telemarketing / do-not-call violations.

For each action return:
- respondent: company name being sued/fined
- state: 2-letter state code of the AG bringing the action (null if multistate/FTC)
- states: array of all states involved (e.g. ["CA","NY","TX"] for multistate)
- violationType: "TCPA" | "robocall" | "do_not_call" | "telemarketing" | "spoofing" | "other"
- restitutionAmount: dollar amount of fine/restitution (number, null if not stated)
- settlementDate: YYYY-MM-DD of consent decree / settlement (null if not stated)
- description: one sentence describing the violation and who was harmed
- sourceUrl: URL of the article (null if not available)
- isConsumerFinancial: true if debt collection / financial services involved (FDCPA overlap)

Return ONLY a JSON array. Empty array [] if no qualifying enforcement actions found.

ARTICLE:
{text}`;

async function extractWithHaiku(text) {
  try {
    const raw = await callHaiku(PROMPT.replace("{text}", text.slice(0, 6000)));
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const items = JSON.parse(clean);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const TCPA_KEYWORDS = /tcpa|robocall|autodialer|do.not.call|unwanted.call|telemarketing|spoofing|debt.collect/i;

function actionToCase(action, agName) {
  const allStates = Array.isArray(action.states) && action.states.length
    ? action.states
    : (action.state ? [action.state] : []);

  return {
    id: `state_ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    caption: `${agName} v. ${action.respondent}`,
    caseType: action.isConsumerFinancial ? "TCPA+FDCPA" : "TCPA",
    defendants: [{ displayName: action.respondent, role: "defendant", canonicalId: null }],
    court: {
      name: action.state ? `${agName} / State Court` : "Multistate AG Enforcement",
      jurisdiction: "state",
      state: action.state || null,
    },
    filingDate: action.settlementDate || null,
    status: action.settlementDate ? "settled" : "active",
    settlement: {
      totalFund: action.restitutionAmount || null,
      perClaimantRange: null,
      claimWindowOpens: null,
      claimWindowCloses: null,
      claimPortalUrl: null,
    },
    conductDescription: action.description || `State AG enforcement for ${action.violationType} violations`,
    geographicScope: allStates.length === 0 || allStates.length > 10 ? "nationwide" : "state",
    eligibleStates: allStates,
    source: "state_ag",
    sourceUrl: action.sourceUrl || null,
    ingestedAt: new Date().toISOString(),
    _agName: agName,
    _violationType: action.violationType,
  };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runStateAgEnforcement({ mode = "daily", since: sinceOverride } = {}) {
  const cursorKey = "tcpa:ingest:state_ag:cursor";
  const statsKey  = "tcpa:ingest:state_ag:stats";

  const sinceRaw = sinceOverride || await kv.get(cursorKey).catch(() => null);
  const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 180 * 24 * 3600 * 1000);

  let fetched = 0;
  let extracted = 0;
  let errors = 0;
  const allCases = [];
  const seenKeys = new Set();

  // Process state AGs in parallel batches of 5 to stay under rate limits
  const BATCH = 5;
  for (let i = 0; i < STATE_AGS.length; i += BATCH) {
    const batch = STATE_AGS.slice(i, i + BATCH);
    await Promise.all(batch.map(async (ag) => {
      try {
        const url = feedUrl(ag.query);
        const feed = await rssParser.parseURL(url);
        for (const item of (feed.items || []).slice(0, 20)) {
          const pubDate = item.pubDate ? new Date(item.pubDate) : null;
          if (pubDate && pubDate < since) continue;

          const text = [item.title || "", item.contentSnippet || "", item.content || ""].join("\n");
          if (!TCPA_KEYWORDS.test(text)) continue;

          fetched++;
          const actions = await extractWithHaiku(text);
          for (const action of actions) {
            if (!action.respondent) continue;
            const key = `${(action.respondent || "").toLowerCase()}|${action.state || "multi"}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            allCases.push(actionToCase(action, ag.name));
            extracted++;
          }
        }
      } catch {
        errors++;
      }
    }));
  }

  let saved = 0;
  if (allCases.length) {
    const result = await importCases(allCases);
    saved = result.new || 0;
  }

  await kv.set(cursorKey, new Date().toISOString(), { ex: 400 * 24 * 3600 });
  const stats = { fetched, extracted, saved, errors, ranAt: new Date().toISOString() };
  await kv.set(statsKey, JSON.stringify(stats), { ex: 48 * 3600 });
  return stats;
}
