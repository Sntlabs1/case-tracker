// FCC Enforcement Bureau — actual enforcement CASES against companies.
//
// This is distinct from fcc-complaints.js which only pulls consumer complaint
// statistics. This module pulls enforcement ORDERS naming specific companies
// for TCPA / robocall / autodialer violations. Each order creates both:
//   (a) a TCPA case record (the FCC action itself), and
//   (b) evidence of willful violation supporting private class actions.
//
// Sources (in priority order):
//   1. FCC News RSS — enforcement press releases naming respondents
//   2. Google News  — "FCC enforcement" + TCPA/robocall queries
//   3. FCC web page scrape — fcc.gov/enforcement/orders (HTML)
//
// Each run: Haiku extracts respondent, violation type, fine amount, order date.
// Writes to tcpa:case:fcc_${id} via importCases().

import { kv } from "@vercel/kv";
import Parser from "rss-parser";
import { importCases } from "../../src/lib/tcpaCaseStore.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
async function callHaiku(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  return (await res.json()).content?.[0]?.text || "";
}
const parser = new Parser({ timeout: 15000 });

// ── Feed sources ─────────────────────────────────────────────────────────────

const FEEDS = [
  // FCC native RSS (enforcement news)
  "https://www.fcc.gov/rss/news-releases.xml",
  // Google News: FCC enforcement orders
  "https://news.google.com/rss/search?q=FCC+enforcement+TCPA+robocall+autodialer&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=FCC+%22consent+decree%22+OR+%22forfeiture+order%22+robocall+2024+OR+2025+OR+2026&hl=en-US&gl=US",
  "https://news.google.com/rss/search?q=FCC+%22notice+of+apparent+liability%22+TCPA+autodialer&hl=en-US&gl=US",
];

// FCC enforcement page (HTML) — top 50 recent orders
const FCC_ENFORCEMENT_URL = "https://www.fcc.gov/enforcement/orders";

// ── Haiku extraction ──────────────────────────────────────────────────────────

const PROMPT = `You are extracting FCC enforcement cases for a TCPA plaintiff litigation platform.

From this news article or FCC enforcement order text, extract every enforcement action against a company for TCPA / robocall / autodialer violations.

For each action return:
- respondent: company name (the one being fined/ordered)
- violationType: "TCPA" | "FDCPA" | "robocall" | "spoofing" | "do_not_call" | "other"
- fineAmount: dollar amount of forfeiture/fine (number, null if not stated)
- orderType: "forfeiture_order" | "consent_decree" | "notice_apparent_liability" | "citation" | "other"
- orderDate: YYYY-MM-DD (null if not stated)
- description: one sentence describing the violation
- caseNumber: FCC docket or EB number if stated (null otherwise)
- sourceUrl: URL of the order if available (null otherwise)

Return ONLY a JSON array. Empty array [] if no qualifying enforcement actions found.

TEXT:
{text}`;

async function extractWithHaiku(text) {
  try {
    const raw = await callHaiku(PROMPT.replace("{text}", text.slice(0, 8000)));
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const items = JSON.parse(clean);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// Convert FCC enforcement action → TCPA case record shape
function enforcementToCase(action, sourceUrl, sourceLabel) {
  const id = `fcc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    caption: `FCC v. ${action.respondent}`,
    caseType: action.violationType === "FDCPA" ? "FDCPA" : "TCPA",
    defendants: [{ displayName: action.respondent, role: "respondent", canonicalId: null }],
    court: { name: "FCC Enforcement Bureau", jurisdiction: "federal", state: null },
    filingDate: action.orderDate,
    status: "active",
    settlement: {
      totalFund: action.fineAmount,
      perClaimantRange: null,
      claimWindowOpens: null,
      claimWindowCloses: null,
      claimPortalUrl: null,
    },
    conductDescription: action.description || `FCC ${action.orderType} for ${action.violationType} violations`,
    geographicScope: "nationwide",
    eligibleStates: [],
    source: "fcc_enforcement",
    sourceUrl: action.sourceUrl || sourceUrl,
    citations: action.caseNumber ? [action.caseNumber] : [],
    ingestedAt: new Date().toISOString(),
    _fccOrderType: action.orderType,
    _fccFine: action.fineAmount,
  };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runFccEnforcement({ mode = "daily", since: sinceOverride } = {}) {
  const cursorKey = "tcpa:ingest:fcc_enforcement:cursor";
  const statsKey  = "tcpa:ingest:fcc_enforcement:stats";

  const sinceRaw = sinceOverride || await kv.get(cursorKey).catch(() => null);
  const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 90 * 24 * 3600 * 1000);

  let totalFetched = 0;
  let totalNew = 0;
  let totalErrors = 0;
  const seenUrls = new Set();
  const allCases = [];

  // ── 1. RSS feeds ───────────────────────────────────────────────────────
  for (const feedUrl of FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of (feed.items || [])) {
        const pubDate = item.pubDate ? new Date(item.pubDate) : null;
        if (pubDate && pubDate < since) continue;
        const url = item.link || item.guid || "";
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const text = [item.title || "", item.contentSnippet || "", item.content || ""].join("\n");
        if (!/tcpa|robocall|autodialer|do.not.call|unwanted.call|spoofing/i.test(text)) continue;

        totalFetched++;
        const actions = await extractWithHaiku(text);
        for (const action of actions) {
          if (!action.respondent) continue;
          allCases.push(enforcementToCase(action, url, "FCC RSS"));
        }
      }
    } catch (e) {
      totalErrors++;
    }
  }

  // ── 2. FCC enforcement page (web scrape) ───────────────────────────────
  try {
    const html = await fetch(FCC_ENFORCEMENT_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TCPABot/1.0)" },
      signal: AbortSignal.timeout(20000),
    }).then(r => r.text());

    // Extract text content (strip tags) and pass to Haiku
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 12000);
    if (/tcpa|robocall|autodialer/i.test(text)) {
      const actions = await extractWithHaiku(text);
      for (const action of actions) {
        if (!action.respondent) continue;
        allCases.push(enforcementToCase(action, FCC_ENFORCEMENT_URL, "FCC Web"));
      }
    }
  } catch {
    totalErrors++;
  }

  // ── 3. Deduplicate by respondent + orderDate ───────────────────────────
  const deduped = [];
  const seen = new Set();
  for (const c of allCases) {
    const key = `${(c.defendants[0]?.displayName || "").toLowerCase()}|${c.filingDate || ""}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(c); }
  }

  // ── 4. Persist ────────────────────────────────────────────────────────
  if (deduped.length) {
    const result = await importCases(deduped);
    totalNew = result.new || 0;
  }

  // ── 5. Update cursor + stats ──────────────────────────────────────────
  await kv.set(cursorKey, new Date().toISOString(), { ex: 400 * 24 * 3600 });
  const stats = { fetched: totalFetched, new: totalNew, errors: totalErrors, ranAt: new Date().toISOString() };
  await kv.set(statsKey, JSON.stringify(stats), { ex: 48 * 3600 });

  return stats;
}
