// POST /api/verify-stage
// Body: { caseName, defendant, mdlNumber, description }
// Searches CourtListener for the case, reads recent docket entries, and uses Claude
// to classify the current litigation stage from actual court filings.
// Returns: { caseStage, caseStageRationale, confidence, docketUrl, docketName, lastActivity, source }

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const STAGES = ["Pre-Litigation", "Filed / Discovery", "MDL Consolidated", "Bellwether Set", "Settlement Discussions", "Resolved"];

function clHeaders() {
  const token = process.env.COURTLISTENER_API_TOKEN;
  return token
    ? { Authorization: `Token ${token}`, Accept: "application/json" }
    : { Accept: "application/json" };
}

async function searchCourtListener(mdlNumber, caseName, defendant) {
  let q = "";
  if (mdlNumber) {
    q = `MDL ${mdlNumber}`;
  } else {
    const name = (caseName || "").replace(/['"]/g, " ").trim().slice(0, 80);
    const def = (defendant || "").replace(/['"]/g, " ").trim().slice(0, 40);
    q = name + (def ? ` "${def}"` : "");
  }
  if (!q.trim()) return [];

  const params = new URLSearchParams({ type: "r", q, order_by: "-dateFiled", page_size: "5" });
  try {
    const r = await fetch(`${CL_BASE}/search/?${params}`, {
      headers: clHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function getDocketEntries(docketId) {
  const params = new URLSearchParams({ docket: docketId, order_by: "-entry_number", page_size: "20" });
  try {
    const r = await fetch(`${CL_BASE}/docket-entries/?${params}`, {
      headers: clHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function classifyWithClaude(caseName, defendant, docket, entries) {
  const docketSummary = [
    `Case: ${docket.case_name || caseName}`,
    `Court: ${docket.court_id || docket.court || "unknown"}`,
    `Docket #: ${docket.docket_number || "unknown"}`,
    `Filed: ${docket.date_filed || "unknown"}`,
    `Last filing: ${docket.date_last_filing || "unknown"}`,
  ].join("\n");

  const entryList = entries.slice(0, 15).map((e, i) =>
    `[${i + 1}] ${e.date_filed || "?"}: ${(e.description || e.short_description || "no description").slice(0, 250)}`
  ).join("\n");

  const prompt = `You are a litigation analyst. Based on the CourtListener docket data below, determine what stage this case is CURRENTLY at.

DOCKET INFO:
${docketSummary}

RECENT DOCKET ENTRIES (newest first):
${entryList || "(no entries found)"}

Return ONLY this JSON (no markdown):
{
  "caseStage": "<one of: Pre-Litigation|Filed / Discovery|MDL Consolidated|Bellwether Set|Settlement Discussions|Resolved>",
  "caseStageRationale": "<1 sentence citing a specific docket entry or fact — e.g. 'JPML transfer order filed 2024-11-12, docket #847, centralized in S.D.N.Y.' or 'Bellwether trial order entered 2025-03-04, first trial set for Sept 2025'>",
  "confidence": <50-99 integer — how certain you are based on the evidence>
}

Rules:
- Pre-Litigation: no complaint filed yet (no docket exists or very first filing)
- Filed / Discovery: complaint filed, case active, no MDL transfer order yet
- MDL Consolidated: JPML transfer order exists OR docket is in an MDL transferee court
- Bellwether Set: court order selecting bellwether cases or setting trial date
- Settlement Discussions: preliminary settlement agreement, fairness hearing scheduled, or claims administration underway
- Resolved: final approval order, judgment, or case terminated
- If entries are sparse or ambiguous, lower your confidence (50-65)
- ONLY cite what you actually see in the entries above, never invent docket numbers or dates`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    const text = (data.content || []).map(b => b.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!STAGES.includes(parsed.caseStage)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { caseName, defendant, mdlNumber } = req.body || {};
  if (!caseName && !mdlNumber) {
    return res.status(400).json({ error: "caseName or mdlNumber required" });
  }

  // 1. Search CourtListener
  const results = await searchCourtListener(mdlNumber, caseName, defendant);
  if (!results.length) {
    return res.status(200).json({
      caseStage: null,
      caseStageRationale: null,
      confidence: 0,
      source: "CourtListener",
      notFound: true,
      message: "No matching docket found on CourtListener. The case may not be filed yet (Pre-Litigation) or the search terms need adjustment.",
    });
  }

  const docket = results[0];
  const docketId = docket.id || docket.docket_id;

  // 2. Get docket entries
  const entries = docketId ? await getDocketEntries(docketId) : [];

  // 3. Classify stage
  const classification = await classifyWithClaude(caseName, defendant, docket, entries);

  if (!classification) {
    // Fall back to docket metadata alone
    return res.status(200).json({
      caseStage: "Filed / Discovery",
      caseStageRationale: `Case found on CourtListener (${docket.docket_number || "no docket #"}), last activity ${docket.date_last_filing || "unknown"}, but entry detail was insufficient to classify precisely.`,
      confidence: 40,
      docketUrl: docket.absolute_url ? `https://www.courtlistener.com${docket.absolute_url}` : null,
      docketName: docket.case_name,
      lastActivity: docket.date_last_filing,
      source: "CourtListener",
    });
  }

  return res.status(200).json({
    ...classification,
    docketUrl: docket.absolute_url ? `https://www.courtlistener.com${docket.absolute_url}` : null,
    docketName: docket.case_name,
    lastActivity: docket.date_last_filing,
    source: "CourtListener",
    entriesChecked: entries.length,
  });
}
