// TCPAWorld.com — Eric Troutman's blog. Authoritative editorial commentary
// on TCPA cases. Posts name cases (often pre-publication on PACER) which we
// extract via Haiku, then reconcile against CourtListener for structured
// docket data.

import Parser from "rss-parser";
import { kv } from "@vercel/kv";

const FEED_URL = "https://tcpaworld.com/feed/";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const EXTRACTION_PROMPT = `Extract every TCPA, FDCPA, or FCRA case mentioned in the article below. For each case, return:
- caption: case name (e.g. "Smith v. Capital One Bank, N.A.")
- caseType: "TCPA", "FDCPA", "FCRA", or "TCPA+FDCPA"
- defendants: array of defendant company names
- court: short court name if mentioned (e.g. "S.D.N.Y.", "9th Cir.")
- docket: docket number if cited (e.g. "1:23-cv-04567")
- filingDate: YYYY-MM-DD if mentioned
- status: "active", "settled", "claim_open", "claim_closed", "dismissed"
- summary: one-sentence summary of the procedural development

Return ONLY a JSON array. No prose. If no cases are mentioned, return [].

Article title: {title}

Article body:
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
  // Haiku sometimes wraps JSON in ```json fences; strip them.
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

// Convert one extracted-case object → buildCase() input. Status defaults to
// "active" since the post may discuss ongoing litigation.
function toCaseInput(extracted, articleUrl, articleDate) {
  if (!extracted.caption || !extracted.caseType) return null;
  const dockSafe = String(extracted.docket || extracted.caption)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 60);
  return {
    id: `tw_${dockSafe}`,
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
    status: extracted.status || "active",
    conductDescription: extracted.summary || "",
    source: "tcpaworld",
    sourceUrl: articleUrl,
  };
}

export async function runTcpaWorld({ mode = "daily", since: sinceOverride, importer }) {
  if (!importer) throw new Error("runTcpaWorld requires importer fn");

  const cursorKey = "tcpa:ingest:tcpaworld:cursor";
  const cursor = await kv.get(cursorKey).catch(() => null);
  const cutoff = sinceOverride
    ? new Date(sinceOverride).getTime()
    : (mode === "backfill"
        ? new Date("2021-01-01").getTime()
        : (cursor ? new Date(cursor).getTime() : Date.now() - 7 * 24 * 3600 * 1000));

  const parser = new Parser({ timeout: 15000 });
  const feed = await parser.parseURL(FEED_URL);

  const items = (feed.items || []).filter((it) => {
    const pub = it.isoDate || it.pubDate;
    return pub ? new Date(pub).getTime() > cutoff : true;
  });

  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0, totalErrors = 0;
  const candidates = [];

  for (const item of items) {
    try {
      const body = (item.contentSnippet || item.content || item.description || "").slice(0, 6000);
      if (!body) continue;
      const prompt = EXTRACTION_PROMPT
        .replace("{title}", item.title || "")
        .replace("{body}", body);
      const raw = await callHaiku(prompt);
      const extracted = tryParseJsonArray(raw);
      const articleDate = item.isoDate ? item.isoDate.slice(0, 10) : null;
      for (const ex of extracted) {
        const input = toCaseInput(ex, item.link || "", articleDate);
        if (input) candidates.push(input);
      }
    } catch (e) {
      totalErrors++;
    }
  }

  if (candidates.length) {
    const r = await importer(candidates);
    totalCreated = r.created;
    totalUpdated = r.updated;
    totalUnchanged = r.unchanged;
    totalErrors += r.errors.length;
  }

  const now = new Date().toISOString();
  await kv.set(cursorKey, now, { ex: 365 * 24 * 3600 }).catch(() => {});
  await kv.set("tcpa:ingest:tcpaworld:stats", JSON.stringify({
    ranAt: now,
    mode,
    itemsConsidered: items.length,
    candidatesExtracted: candidates.length,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  }), { ex: 30 * 24 * 3600 }).catch(() => {});

  return {
    source: "tcpaworld",
    mode,
    itemsConsidered: items.length,
    candidatesExtracted: candidates.length,
    created: totalCreated,
    updated: totalUpdated,
    unchanged: totalUnchanged,
    errors: totalErrors,
  };
}
