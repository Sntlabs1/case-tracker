// Case-tracker agent — periodically checks ingested TCPA / FDCPA / FCRA cases
// for status changes: settlements, motions to dismiss, class certifications,
// MDL transfers, voluntary dismissals.
//
// For each case in priority order it:
//   1. (Federal + has docket #) queries CourtListener for new docket entries
//      since `lastDocketDate`.
//   2. Runs a Haiku web search scoped to the case caption + defendants
//      looking for milestone keywords ("settlement", "motion to dismiss",
//      "class certification", etc.).
//   3. Asks Haiku to classify any findings into a typed event.
//   4. Appends events to tcpa:case_history:${caseId}.
//   5. For high-confidence status-changing events, updates the case via
//      importCase() and refreshes the inverted indexes.
//
// Conservative defaults — this agent makes outbound API/Haiku calls, so the
// per-run cap is small (default 30 cases). State transitions only fire on
// confidence ≥ 80 to avoid auto-marking cases dismissed based on weak signal.
//
// Schedule: daily at 06:30 UTC (after the ingest cron at 06:00).

import { kv } from "@vercel/kv";
import { KEYS, CASE_STATUSES } from "../../src/lib/ingest/tcpaSchema.js";
import { importCase } from "../../src/lib/ingest/tcpaCaseStore.js";

const HAIKU = "claude-haiku-4-5-20251001";
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

const MAX_CASES_PER_RUN     = 30;
const CL_REQUESTS_PER_RUN   = 50;   // CourtListener free tier: 5000/hr
const WEB_SEARCHES_PER_RUN  = 30;   // Haiku web_search tool calls
const STATUS_CONFIDENCE_MIN = 80;   // require ≥ this to auto-update status
const HISTORY_KEY = (id) => `tcpa:case_history:${id}`;
const HISTORY_MAX = 50;
const RECHECK_DAYS = {
  active:       7,
  settled:      3,
  claim_open:   1,
  claim_closed: 30,
  dismissed:    365,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function shouldRecheck(caseRecord) {
  const threshold = RECHECK_DAYS[caseRecord.status] ?? 7;
  return daysAgo(caseRecord.lastVerifiedAt) >= threshold;
}

async function loadCasesToCheck(max) {
  // Walk filing-date index newest first. We don't want to re-check newly
  // ingested cases that have no docket data anyway, so prefer cases ≥ 60d old.
  const ids = await kv.zrange(KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
  const out = [];
  const BATCH = 100;
  for (let i = 0; i < ids.length && out.length < max; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const records = await Promise.all(slice.map((id) => kv.get(KEYS.case(id))));
    for (const r of records) {
      if (!r) continue;
      const c = typeof r === "string" ? JSON.parse(r) : r;
      if (!shouldRecheck(c)) continue;
      out.push(c);
      if (out.length >= max) break;
    }
  }
  return out;
}

// ── CourtListener docket polling ─────────────────────────────────────────────
async function fetchCourtListenerDocket(caseRecord) {
  if (caseRecord.court?.jurisdiction !== "federal") return null;
  const dn = caseRecord.court?.docket;
  if (!dn) return null;
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) return null;

  // Strip the case-numbering scheme: "8:19-CV-2523-T-60AAS" → "19-cv-2523"
  // Best-effort; CourtListener's docket_number_core matches loosely.
  const core = dn
    .toLowerCase()
    .replace(/^\d{1,2}[-:]/, "") // strip leading judge district prefix
    .replace(/-(?:t|j|jc|ssp)-.*$/i, "") // strip judge initials suffix
    .replace(/\s+/g, "")
    .trim();

  const url = `${CL_BASE}/dockets/?docket_number_core=${encodeURIComponent(core)}&page_size=5`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results || [])[0] || null;
  } catch {
    return null;
  }
}

// ── Haiku helpers ────────────────────────────────────────────────────────────
async function claudeJSON(messages, system, { maxTokens = 700, tools } = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const body = { model: HAIKU, max_tokens: maxTokens, system, messages };
    if (tools) body.tools = tools;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const d = await r.json();
    const text = (d.content || []).map((b) => b.text || "").filter(Boolean).join("");
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function webSearchCaseEvents(caseRecord) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const defendants = (caseRecord.defendants || []).map((d) => d.displayName).filter(Boolean).join(", ");
  const query = `"${caseRecord.caption}" (settlement OR "motion to dismiss" OR "class certification" OR dismissed OR "claim deadline") ${caseRecord.caseType} 2026`;
  const system = `You are a docket monitor. Given a case caption and recent web search results, identify case-status events. Return JSON only.

Schema:
{
  "events": [
    {
      "type": "settlement_preliminary" | "settlement_final" | "claim_window_opens" | "claim_window_closes" | "mtd_filed" | "mtd_granted" | "mtd_denied" | "class_cert_granted" | "class_cert_denied" | "transfer_mdl" | "voluntary_dismissal" | "stay_ordered" | "other_filing",
      "summary": "<one sentence>",
      "date": "<YYYY-MM-DD if known, else null>",
      "confidence": 0-100,
      "url": "<source URL>",
      "settlementAmount": "<dollar string if applicable, else null>",
      "claimDeadline": "<YYYY-MM-DD if applicable, else null>"
    }
  ]
}

Only include events you can CITE to a specific search result. If nothing relevant found, return {"events": []}.`;

  const out = await claudeJSON(
    [{ role: "user", content: `Case: ${caseRecord.caption}\nDefendants: ${defendants}\nCourt: ${caseRecord.court?.name}\nFiled: ${caseRecord.filingDate}\nCurrent status: ${caseRecord.status}\n\nSearch the web for any recent docket activity. Query suggestion: ${query}` }],
    system,
    {
      maxTokens: 1200,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }
  );
  return out;
}

// ── Event handlers ───────────────────────────────────────────────────────────
const STATUS_MAP = {
  settlement_preliminary: "settled",
  settlement_final:       "settled",
  claim_window_opens:     "claim_open",
  claim_window_closes:    "claim_closed",
  mtd_granted:            "dismissed",
  voluntary_dismissal:    "dismissed",
};

function applyEventToRecord(record, event) {
  const update = { ...record };
  const newStatus = STATUS_MAP[event.type];
  if (newStatus && CASE_STATUSES.includes(newStatus)) update.status = newStatus;

  if (event.type === "settlement_preliminary" || event.type === "settlement_final") {
    update.settlement = { ...(update.settlement || {}) };
    if (event.date && event.type === "settlement_final") update.settlement.finalApprovalDate = event.date;
    if (event.date && event.type === "settlement_preliminary") update.settlement.fairnessHearingDate = event.date;
    if (event.settlementAmount) update.settlement.totalFund = event.settlementAmount;
  }
  if (event.type === "claim_window_opens" || event.type === "claim_window_closes") {
    update.settlement = { ...(update.settlement || {}) };
    if (event.type === "claim_window_opens" && event.date) update.settlement.claimWindowOpens = event.date;
    if (event.type === "claim_window_closes" && (event.date || event.claimDeadline)) {
      update.settlement.claimWindowCloses = event.date || event.claimDeadline;
    }
  }

  update.lastDocketDate = event.date || update.lastDocketDate;
  return update;
}

async function appendHistory(caseId, events) {
  if (!events.length) return;
  const ts = new Date().toISOString();
  const payload = events.map((e) => JSON.stringify({ ...e, recordedAt: ts }));
  await kv.lpush(HISTORY_KEY(caseId), ...payload).catch(() => {});
  await kv.ltrim(HISTORY_KEY(caseId), 0, HISTORY_MAX - 1).catch(() => {});
}

async function touchLastVerified(caseRecord) {
  const updated = { ...caseRecord, lastVerifiedAt: new Date().toISOString() };
  await kv.set(KEYS.case(caseRecord.id), JSON.stringify(updated), { ex: 365 * 24 * 3600 }).catch(() => {});
}

// ── Process one case ─────────────────────────────────────────────────────────
async function processCase(caseRecord, budgets) {
  const result = {
    id: caseRecord.id,
    caption: caseRecord.caption,
    events: 0,
    statusUpdated: null,
    error: null,
  };

  const allEvents = [];

  // 1. CourtListener docket poll (federal cases only, budget-gated)
  if (budgets.courtListener > 0) {
    try {
      const docket = await fetchCourtListenerDocket(caseRecord);
      budgets.courtListener--;
      if (docket && docket.date_last_filing && docket.date_last_filing > (caseRecord.lastDocketDate || "")) {
        allEvents.push({
          type: "other_filing",
          summary: `CourtListener shows new activity through ${docket.date_last_filing} (docket ${docket.docket_number || ""})`,
          date: docket.date_last_filing,
          confidence: 70,
          url: docket.absolute_url ? `https://www.courtlistener.com${docket.absolute_url}` : null,
          source: "courtlistener",
        });
      }
    } catch (e) {
      result.error = `CL: ${e.message}`;
    }
  }

  // 2. Web search (budget-gated)
  if (budgets.webSearches > 0) {
    try {
      const search = await webSearchCaseEvents(caseRecord);
      budgets.webSearches--;
      const events = Array.isArray(search?.events) ? search.events : [];
      for (const ev of events) {
        if (!ev.type || !ev.summary) continue;
        allEvents.push({ ...ev, source: ev.source || "web" });
      }
    } catch (e) {
      result.error = (result.error || "") + ` web: ${e.message}`;
    }
  }

  // 3. Apply
  if (allEvents.length) {
    await appendHistory(caseRecord.id, allEvents);
    result.events = allEvents.length;

    // Pick the highest-confidence status-changing event to apply
    const statusEvents = allEvents
      .filter((e) => STATUS_MAP[e.type] && (e.confidence ?? 0) >= STATUS_CONFIDENCE_MIN)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    if (statusEvents.length) {
      const top = statusEvents[0];
      const updated = applyEventToRecord(caseRecord, top);
      try {
        await importCase(updated);
        result.statusUpdated = updated.status;
      } catch (e) {
        result.error = (result.error || "") + ` apply: ${e.message}`;
      }
    } else {
      await touchLastVerified(caseRecord);
    }
  } else {
    await touchLastVerified(caseRecord);
  }

  return result;
}

// ── Agent export ─────────────────────────────────────────────────────────────
export default {
  name: "case-tracker",
  description:
    "Polls ingested TCPA/FDCPA/FCRA cases for status changes (settlements, " +
    "MTDs, class cert, dismissals). Uses CourtListener for federal dockets " +
    "and Haiku web search for everything else. Auto-applies status updates " +
    "only on confidence ≥ 80; lower-confidence findings go to per-case history.",
  schedule: "30 6 * * *", // daily at 06:30 UTC

  async run({ max = MAX_CASES_PER_RUN } = {}) {
    const startedAt = Date.now();
    const budgets = {
      courtListener: CL_REQUESTS_PER_RUN,
      webSearches:   WEB_SEARCHES_PER_RUN,
    };

    const cases = await loadCasesToCheck(max);
    if (!cases.length) {
      return {
        ok: true,
        summary: { checked: 0, eventsRecorded: 0, statusUpdates: 0, note: "no cases due for re-check" },
        result: { durationMs: Date.now() - startedAt },
      };
    }

    let eventsRecorded = 0;
    let statusUpdates = 0;
    const errors = [];
    const updates = [];

    for (const c of cases) {
      try {
        const r = await processCase(c, budgets);
        eventsRecorded += r.events;
        if (r.statusUpdated) {
          statusUpdates++;
          updates.push({ id: r.id, caption: r.caption, status: r.statusUpdated });
        }
        if (r.error) errors.push({ id: r.id, error: r.error });
      } catch (e) {
        errors.push({ id: c.id, error: e.message });
      }
      // Bail early if we've drained both budgets
      if (budgets.courtListener <= 0 && budgets.webSearches <= 0) break;
    }

    return {
      ok: true,
      summary: {
        checked: cases.length,
        eventsRecorded,
        statusUpdates,
        errors: errors.length,
        clBudgetUsed: CL_REQUESTS_PER_RUN - budgets.courtListener,
        webBudgetUsed: WEB_SEARCHES_PER_RUN - budgets.webSearches,
      },
      result: {
        durationMs: Date.now() - startedAt,
        updates,
        errorsSample: errors.slice(0, 5),
      },
    };
  },
};
