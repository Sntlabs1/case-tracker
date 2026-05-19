// ClassAction.org + TopClassActions — RSS feeds covering settlement-side
// announcements and new class action filings. Shape is similar enough to
// share one module; we tag the source field per feed.

import Parser from "rss-parser";
import { kv } from "@vercel/kv";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Google News RSS — plain queries work; site: restrictions return 0 results.
// Multiple targeted queries to maximize coverage of open claim windows.
const FEEDS = [
  {
    url: "https://news.google.com/rss/search?q=TCPA+settlement+claim+deadline&hl=en-US&gl=US&ceid=US:en",
    source: "ClassAction.org",
  },
  {
    url: "https://news.google.com/rss/search?q=FDCPA+class+action+settlement+claim+form&hl=en-US&gl=US&ceid=US:en",
    source: "TopClassActions",
  },
  {
    url: "https://news.google.com/rss/search?q=robocall+autodialer+settlement+file+claim&hl=en-US&gl=US&ceid=US:en",
    source: "ClassAction.org",
  },
  {
    url: "https://news.google.com/rss/search?q=TCPA+class+action+settlement+2025+OR+2026&hl=en-US&gl=US&ceid=US:en",
    source: "TopClassActions",
  },
];

// Strict JSON-array extraction — same skeleton as tcpaworld.js but tuned for
// settlement language (claim windows, total funds, fairness hearings).
const EXTRACTION_PROMPT = `Extract every TCPA, FDCPA, or FCRA case mentioned in this article. For each, return:
- caption: case name
- caseType: "TCPA" | "FDCPA" | "FCRA" | "TCPA+FDCPA"
- defendants: array of defendant company names
- court: short court name if mentioned
- docket: docket number if cited
- filingDate: YYYY-MM-DD if mentioned
- status: "active" | "settled" | "claim_open" | "claim_closed" | "dismissed"
- settlementTotal: dollar amount of settlement fund if disclosed (number, no commas)
- claimDeadline: YYYY-MM-DD claim window close date if disclosed
- claimPortalUrl: URL to claim form if disclosed
- summary: one-sentence summary

Return ONLY a JSON array. No prose. If no qualifying cases, return [].

Title: {title}

Body:
{body}`;

async function callHaiku(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function tryParseJsonArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

function toCaseInput(extracted, articleUrl, articleDate, sourceTag) {
  if (!extracted.caption || !extracted.caseType) return null;
  // Stable IDs per source so the same case from both feeds doesn't double-write.
  const prefix = sourceTag === "TopClassActions" ? "tca" : "ca";
  const dockSafe = String(extracted.docket || extracted.caption)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 60);
  return {
    id: `${prefix}_${dockSafe}`,
    caption: extracted.caption,
    caseType: extracted.caseType,
    defendants: extracted.defendants || [],
    court: {
      name: extracted.court || "",
      jurisdiction: "federal",
      state: "",
      docket: extracted.docket || "",
    },
    filingDate: extracted.filingDate || articleDate || new Date().toISOString().slice(0, 10),
    status: extracted.status || "settled",
    settlement: {
      totalFund: extracted.settlementTotal || null,
      claimWindowCloses: extracted.claimDeadline || null,
      claimPortalUrl: extracted.claimPortalUrl || null,
    },
    conductDescription: extracted.summary || "",
    source: sourceTag,
    sourceUrl: articleUrl,
  };
}

async function processFeed(feedUrl, sourceTag, cutoff) {
  const parser = new Parser({
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalResearchBot/1.0)" },
  });
  const feed = await parser.parseURL(feedUrl);
  const items = (feed.items || []).filter((it) => {
    const pub = it.isoDate || it.pubDate;
    return pub ? new Date(pub).getTime() > cutoff : true;
  });

  const candidates = [];
  let extractionErrors = 0;

  for (const item of items) {
    try {
      // Google News RSS has no article body — title + snippet is all we get.
      // The title alone usually contains defendant name, settlement amount,
      // and claim deadline (e.g. "Western Express $2.7M TCPA settlement: claim by Aug 1").
      const body = (item.contentSnippet || item.content || item.description || "").slice(0, 6000);
      const text = [item.title || "", body].filter(Boolean).join("\n");
      if (!text.trim()) continue;
      const prompt = EXTRACTION_PROMPT
        .replace("{title}", item.title || "")
        .replace("{body}", text);
      const raw = await callHaiku(prompt);
      const extracted = tryParseJsonArray(raw);
      const articleDate = item.isoDate ? item.isoDate.slice(0, 10) : null;
      for (const ex of extracted) {
        const input = toCaseInput(ex, item.link || "", articleDate, sourceTag);
        if (input) candidates.push(input);
      }
    } catch (e) {
      extractionErrors++;
    }
  }

  return { itemsConsidered: items.length, candidates, extractionErrors };
}

export async function runClassActionRss({ mode = "daily", since: sinceOverride, importer }) {
  if (!importer) throw new Error("runClassActionRss requires importer fn");

  const cursorKey = "tcpa:ingest:classaction:cursor";
  const cursor = await kv.get(cursorKey).catch(() => null);
  const cutoff = sinceOverride
    ? new Date(sinceOverride).getTime()
    : (mode === "backfill"
        ? new Date("2021-01-01").getTime()
        : (cursor ? new Date(cursor).getTime() : Date.now() - 7 * 24 * 3600 * 1000));

  let totalConsidered = 0, totalCandidates = 0, totalErrors = 0;
  const allCandidates = [];

  for (const feed of FEEDS) {
    try {
      const { itemsConsidered, candidates, extractionErrors } = await processFeed(feed.url, feed.source, cutoff);
      totalConsidered += itemsConsidered;
      totalErrors += extractionErrors;
      allCandidates.push(...candidates);
    } catch (e) {
      totalErrors++;
    }
  }
  totalCandidates = allCandidates.length;

  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0;
  if (allCandidates.length) {
    const r = await importer(allCandidates);
    totalCreated = r.created;
    totalUpdated = r.updated;
    totalUnchanged = r.unchanged;
    totalErrors += r.errors.length;
  }

  const now = new Date().toISOString();
  await kv.set(cursorKey, now, { ex: 365 * 24 * 3600 }).catch(() => {});
  await kv.set("tcpa:ingest:classaction:stats", JSON.stringify({
    ranAt: now,
    mode,
    itemsConsidered: totalConsidered,
    candidatesExtracted: totalCandidates,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  }), { ex: 30 * 24 * 3600 }).catch(() => {});

  return {
    source: "classaction",
    mode,
    itemsConsidered: totalConsidered,
    candidatesExtracted: totalCandidates,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  };
}
