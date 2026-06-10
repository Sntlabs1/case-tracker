// TopClassActions + ClassAction.org direct scraper.
//
// The existing classaction-rss.js uses Google News as a proxy because both
// sites block direct RSS access. This module goes further: it fetches the
// actual open-settlements pages directly and extracts structured claim data
// that Google News doesn't index (claim deadlines, per-claimant amounts,
// claim portal URLs, class definitions).
//
// Sources:
//   TopClassActions — open settlement listings, TCPA category
//   ClassAction.org — open settlements + blog/news
//
// Each item → Haiku extraction → TCPA case record with:
//   claimWindowCloses, perClaimantRange, claimPortalUrl, classDefinition
//
// These fields are the most valuable for the claim-filing tracker (item 3).

import { kv } from "@vercel/kv";
import { importCases } from "../../src/lib/ingest/tcpaCaseStore.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
async function callHaiku(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  return (await res.json()).content?.[0]?.text || "";
}

const PAGES = [
  // TopClassActions — TCPA/robocall category + open settlements
  {
    url: "https://topclassactions.com/lawsuit-settlements/open-lawsuit-settlements/",
    source: "TopClassActions",
    filter: /tcpa|robocall|telemar|autodialer|debt.collect|fdcpa|text.message|unwanted.call/i,
  },
  {
    url: "https://topclassactions.com/lawsuit-settlements/lawsuit-news/category/tcpa-class-action/",
    source: "TopClassActions",
    filter: /./,
  },
  // ClassAction.org — open settlements
  {
    url: "https://www.classaction.org/open-class-action-settlements",
    source: "ClassAction.org",
    filter: /tcpa|robocall|telemar|autodialer|debt.collect|fdcpa|text.message|unwanted.call/i,
  },
  {
    url: "https://www.classaction.org/blog/category/tcpa",
    source: "ClassAction.org",
    filter: /./,
  },
  // Additional settlement-focused pages
  {
    url: "https://topclassactions.com/lawsuit-settlements/open-lawsuit-settlements/phone-tcpa/",
    source: "TopClassActions",
    filter: /./,
  },
];

// ── Haiku extraction ──────────────────────────────────────────────────────────

const PROMPT = `You are extracting TCPA/FDCPA class action settlements from a class action news website for a plaintiff litigation firm.

Extract every TCPA, FDCPA, or FCRA case or settlement listed in the page text. For each:
- caption: official case name (e.g. "Smith v. Capital One")
- caseType: "TCPA" | "FDCPA" | "FCRA" | "TCPA+FDCPA"
- defendants: array of defendant company names
- court: court name (e.g. "N.D. Cal.", "S.D.N.Y.")
- docket: case number if mentioned
- status: "active" | "settled" | "claim_open" | "claim_closed"
- settlementTotal: total settlement fund in dollars (number only, null if not stated)
- perClaimantRange: per-claimant payment description (string, e.g. "$45-$120" or "up to $500")
- claimDeadline: YYYY-MM-DD deadline to submit a claim (null if not stated)
- claimPortalUrl: direct URL to the claim form or settlement website (null if not stated)
- classDefinition: who qualifies — copy the exact class definition text if available
- conductDescription: what the defendant did (one sentence)
- filingDate: YYYY-MM-DD case was filed (null if not stated)
- adminName: settlement administrator company name (e.g. "Kroll", "Epiq", "Simpluris", null if not stated)
- adminPhone: toll-free phone number for the settlement administrator (null if not stated)
- adminEmail: email address for claimant inquiries (null if not stated)
- adminWebsite: URL to the administrator website (null if not stated)

Only include TCPA, FDCPA, FCRA cases. Skip personal injury, securities, employment.
Return ONLY a JSON array. Empty array [] if no qualifying cases.

PAGE TEXT:
{text}`;

async function extractWithHaiku(text, source) {
  try {
    const raw = await callHaiku(PROMPT.replace("{text}", text.slice(0, 12000)));
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const items = JSON.parse(clean);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// Convert extracted item → TCPA case record
function itemToCase(item, source, pageUrl) {
  const id = `tca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    caption: item.caption || `Unknown case (${source})`,
    caseType: item.caseType || "TCPA",
    defendants: (item.defendants || []).map(d => ({ displayName: d, role: "defendant", canonicalId: null })),
    court: { name: item.court || null, jurisdiction: "federal", state: null },
    filingDate: item.filingDate || null,
    status: item.status || (item.claimDeadline ? "claim_open" : "settled"),
    settlement: {
      totalFund:         item.settlementTotal ? String(item.settlementTotal) : null,
      perClaimantRange:  item.perClaimantRange  || null,
      claimWindowOpens:  null,
      claimWindowCloses: item.claimDeadline     || null,
      claimPortalUrl:    item.claimPortalUrl    || null,
      claimRequirements: item.classDefinition   || null,
      adminName:         item.adminName         || null,
      adminPhone:        item.adminPhone        || null,
      adminEmail:        item.adminEmail        || null,
      adminWebsite:      item.adminWebsite      || null,
      finalApprovalDate: null,
    },
    classDefinition:     item.classDefinition || null,
    conductDescription:  item.conductDescription || null,
    geographicScope: "nationwide",
    eligibleStates: [],
    source,
    sourceUrl: item.claimPortalUrl || pageUrl,
    citations: item.docket ? [item.docket] : [],
    ingestedAt: new Date().toISOString(),
  };
}

// Fetch a page with rotating user agents and a timeout
async function fetchPage(url) {
  const agents = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];
  const ua = agents[Math.floor(Math.random() * agents.length)];
  const r = await fetch(url, {
    headers: {
      "User-Agent": ua,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  // Strip tags and collapse whitespace — feed text directly to Haiku
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runTopClassActions({ mode = "daily" } = {}) {
  const cursorKey = "tcpa:ingest:topclassactions:cursor";
  const statsKey  = "tcpa:ingest:topclassactions:stats";

  let fetched = 0;
  let extracted = 0;
  let saved = 0;
  let errors = 0;
  const allCases = [];
  const seenCaptions = new Set();

  for (const page of PAGES) {
    try {
      const text = await fetchPage(page.url);
      if (!page.filter.test(text)) continue;
      fetched++;

      const items = await extractWithHaiku(text, page.source);
      for (const item of items) {
        if (!item.caption || seenCaptions.has(item.caption.toLowerCase())) continue;
        seenCaptions.add(item.caption.toLowerCase());
        allCases.push(itemToCase(item, page.source, page.url));
        extracted++;
      }
    } catch (e) {
      errors++;
      console.error(`TopClassActions scraper error (${page.url}):`, e.message);
    }

    // Small delay between pages to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  if (allCases.length) {
    const result = await importCases(allCases);
    saved = result.new || 0;
  }

  await kv.set(cursorKey, new Date().toISOString(), { ex: 400 * 24 * 3600 });
  const stats = { fetched, extracted, saved, errors, ranAt: new Date().toISOString() };
  await kv.set(statsKey, JSON.stringify(stats), { ex: 48 * 3600 });
  return stats;
}
