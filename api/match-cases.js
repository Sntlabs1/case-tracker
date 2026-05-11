// Vercel serverless — generalized client × case match engine.
//
// POST /api/match-cases
// Body:
//   { mode: "case-to-clients", caseId, caseType?, firmFilter?, topN? }
//   { mode: "client-to-cases", clientId, caseType?, topN? }
//
// caseId is auto-routed by prefix:
//   "tcpa_..." → loaded from tcpa:case:${id}, scored via rules-first TCPA rubric
//   anything else → loaded from lead:${id},  scored via the existing Haiku batch
//
// caseType options:
//   "TCPA"      — force TCPA scoring path
//   "MASS_TORT" — force mass-tort Haiku path (legacy match-clients.js behavior)
//   "AUTO"      — infer from case prefix (default)
//
// In client-to-cases mode, results from both pools are merged and ranked.

import { kv } from "@vercel/kv";
import { scoreTcpaPair } from "../src/lib/tcpaMatchRubric.js";
import { KEYS as TCPA_KEYS } from "../src/lib/tcpaSchema.js";

const HAIKU = "claude-haiku-4-5-20251001";
const BATCH = 20;
const MAX_CLIENTS = 2000;
const HAIKU_ESCALATION_THRESHOLD = 70; // If rules confidence < this, escalate

async function claudeJSON(messages, system, maxTokens = 1500) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: HAIKU, max_tokens: maxTokens, system, messages }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    const raw = d.content?.[0]?.text || "[]";
    const m = raw.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── Case loaders ─────────────────────────────────────────────────────────────
async function loadCaseById(caseId) {
  if (!caseId) return null;
  if (caseId.startsWith("tcpa_")) {
    const raw = await kv.get(TCPA_KEYS.case(caseId));
    if (!raw) return null;
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { kind: "tcpa", record };
  }
  const raw = await kv.get(`lead:${caseId}`);
  if (!raw) return null;
  const record = typeof raw === "string" ? JSON.parse(raw) : raw;
  return { kind: "lead", record };
}

function inferCaseType(loaded, override) {
  if (override && override !== "AUTO") return override;
  return loaded.kind === "tcpa" ? "TCPA" : "MASS_TORT";
}

// ── Client loader ────────────────────────────────────────────────────────────
async function loadClients({ firmFilter, max = MAX_CLIENTS }) {
  const ids = await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []);
  const clients = [];
  for (let i = 0; i < Math.min(ids.length, max); i += 100) {
    const batch = await Promise.all(ids.slice(i, i + 100).map((id) => kv.get(`client:${id}`)));
    batch.forEach((r) => {
      if (!r) return;
      const c = typeof r === "string" ? JSON.parse(r) : r;
      if (firmFilter && c.sourceFirm !== firmFilter) return;
      clients.push(c);
    });
  }
  return clients;
}

// ── TCPA scoring path (rules-first, optional Haiku escalation) ───────────────
async function scoreTcpaCaseAgainstClients(caseRecord, clients) {
  const out = [];
  const lowConfidence = [];

  for (const client of clients) {
    const r = scoreTcpaPair(client, caseRecord);
    const enriched = { id: client.id, ...r, reason: summarizeRules(r) };
    if (r.confidence < HAIKU_ESCALATION_THRESHOLD && r.matchType !== "disqualified" && r.matchType !== "none") {
      lowConfidence.push({ client, base: enriched });
    }
    out.push(enriched);
  }

  // Escalate low-confidence cases to Haiku in batches.
  if (lowConfidence.length) {
    const escalated = await haikuRefineTcpaScores(caseRecord, lowConfidence);
    const refinedById = new Map(escalated.map((e) => [e.id, e]));
    for (let i = 0; i < out.length; i++) {
      const refined = refinedById.get(out[i].id);
      if (refined) out[i] = { ...out[i], ...refined, confidenceSource: "haiku" };
    }
  }

  return out;
}

function summarizeRules(r) {
  if (r.matchType === "disqualified") return r.disqualifyingFactors[0] || "Disqualified";
  if (!r.matchingFactors.length) return "No matching factors";
  return r.matchingFactors.slice(0, 3).join("; ");
}

async function haikuRefineTcpaScores(caseRecord, items) {
  const system = `You are a TCPA / FDCPA plaintiff intake specialist. For each client below, judge whether they qualify as a class member or claimant in this specific case. Apply STRICT scoring — only mark qualifies=true with strong evidence.

Return ONLY a JSON array, one object per client:
[{"id":"client_id","score":0-100,"qualifies":true|false,"reason":"one sentence","matchingFactors":["..."],"disqualifyingFactors":["..."]}]`;

  const caseSummary = `Case: ${caseRecord.caption}
Type: ${caseRecord.caseType}
Defendants: ${(caseRecord.defendants || []).map((d) => d.displayName).join(", ")}
Conduct: ${caseRecord.conductDescription || "Not specified"}
Class definition: ${caseRecord.classDefinition || "Not specified"}
Class period: ${caseRecord.classPeriod?.start || "?"} to ${caseRecord.classPeriod?.end || "?"}
Eligible states: ${(caseRecord.eligibleStates || []).join(", ") || "(see geographicScope)"}
Geographic scope: ${caseRecord.geographicScope || "?"}
Status: ${caseRecord.status}`;

  const results = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const clientList = batch.map(({ client, base }) => ({
      id: client.id,
      name: `${client.firstName} ${client.lastName}`,
      state: client.state,
      phoneNumbers: client.phoneNumbers || [],
      collectionsHistory: (client.collectionsHistory || []).map((e) => ({
        creditor: e.creditor,
        debtBuyer: e.debtBuyer,
        dateRange: e.dateRange,
        contactMethods: e.contactMethods,
      })),
      addressHistory: client.addressHistory || [],
      existingCases: client.existingCases,
      rulesScore: base.score,
      rulesMatchType: base.matchType,
      rulesNotes: base.matchingFactors,
    }));
    const out = await claudeJSON(
      [{
        role: "user",
        content: `CASE:\n${caseSummary}\n\nCLIENTS:\n${JSON.stringify(clientList, null, 1)}\n\nReturn JSON array.`,
      }],
      system,
      1500
    );
    if (Array.isArray(out)) results.push(...out);
  }
  return results;
}

// ── Mass-tort scoring path (existing Haiku batch logic — preserved verbatim) ─
async function scoreMassTortCaseAgainstClients(lead, clients) {
  const a = lead.analysis || {};
  const requirements = [
    `Case: ${a.headline || lead.title}`,
    `Case Type: ${a.caseType || "Unknown"}`,
    `Required Injury/Condition: ${a.plaintiffProfile?.requiredInjury || "Not specified"}`,
    `Product/Medication: ${a.plaintiffProfile?.productOrMedication || a.plaintiffProfile?.acquisitionHook || "Not specified"}`,
    `Demographics: ${a.plaintiffProfile?.demographics || "General public"}`,
    `Disqualifiers: ${a.plaintiffProfile?.disqualifiers || "None specified"}`,
    `Geographic Scope: ${a.classProfile?.geographicScope || "National"}`,
    `Exposure Period: ${a.timeline?.exposurePeriod || a.plaintiffProfile?.injuryTimeframe || "Not specified"}`,
  ].join("\n");

  const system = `You are a plaintiff intake specialist for a class action law firm.
Score each client's eligibility for this specific case. Be strict — only score high if the client clearly meets the criteria.
Return ONLY a JSON array, no other text.`;

  const batches = [];
  for (let i = 0; i < clients.length; i += BATCH) batches.push(clients.slice(i, i + BATCH));

  const CONCURRENCY = 8;
  const allScored = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const wave = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map((batch) => {
      const clientList = batch.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        state: c.state,
        age: c.age,
        injuries: c.injuries,
        products: c.productsUsed,
        medications: c.medicationsUsed,
        exposure: c.exposurePeriod,
        occupation: c.occupation,
        notes: c.caseNotes?.slice(0, 200),
      }));
      return claudeJSON(
        [{
          role: "user",
          content: `CASE REQUIREMENTS:\n${requirements}\n\nCLIENTS TO EVALUATE:\n${JSON.stringify(clientList, null, 1)}\n\nReturn JSON array with one object per client:\n[{"id":"client_id","score":0-100,"qualifies":true/false,"reason":"one sentence","matchingFactors":["..."],"disqualifyingFactors":["..."]}]`,
        }],
        system,
        1500
      );
    }));
    results.forEach((r) => allScored.push(...r));
  }
  return allScored.map((s) => ({ ...s, confidenceSource: "haiku" }));
}

// ── Mode A handler: case-to-clients ─────────────────────────────────────────
async function handleCaseToClients({ caseId, caseType, firmFilter }) {
  const loaded = await loadCaseById(caseId);
  if (!loaded) return { status: 404, body: { error: "Case not found" } };

  const resolvedType = inferCaseType(loaded, caseType);
  const clients = await loadClients({ firmFilter });
  if (!clients.length) {
    return { status: 200, body: { matches: [], caseId, total: 0 } };
  }

  let scored;
  if (resolvedType === "TCPA") {
    scored = await scoreTcpaCaseAgainstClients(loaded.record, clients);
  } else {
    scored = await scoreMassTortCaseAgainstClients(loaded.record, clients);
  }

  const valid = scored
    .filter((r) => r && r.id && typeof r.score === "number")
    .sort((a, b) => b.score - a.score);

  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const enriched = valid.map((s) => ({ ...s, client: clientMap[s.id] || null })).filter((s) => s.client);

  const heading = loaded.kind === "tcpa"
    ? loaded.record.caption
    : (loaded.record.analysis?.headline || loaded.record.title);

  return {
    status: 200,
    body: {
      caseId,
      caseType: resolvedType,
      caseTitle: heading,
      matches: enriched,
      qualifying: enriched.filter((s) => s.qualifies).length,
      total: clients.length,
      scannedAt: new Date().toISOString(),
    },
  };
}

// ── Mode B handler: client-to-cases ─────────────────────────────────────────
async function handleClientToCases({ clientId, caseType, topN = 10 }) {
  const rawClient = await kv.get(`client:${clientId}`);
  if (!rawClient) return { status: 404, body: { error: "Client not found" } };
  const client = typeof rawClient === "string" ? JSON.parse(rawClient) : rawClient;

  // ── Score against TCPA cases ──────────────────────────────────────────────
  let tcpaScored = [];
  let tcpaMap = {};
  if (caseType !== "MASS_TORT") {
    const tcpaIds = await kv.zrange(TCPA_KEYS.byFilingDate(), 0, -1, { rev: true }).catch(() => []);
    const topTcpaIds = tcpaIds.slice(0, 200);
    const tcpaCases = (await Promise.all(topTcpaIds.map((id) => kv.get(TCPA_KEYS.case(id)))))
      .map((r) => (r ? (typeof r === "string" ? JSON.parse(r) : r) : null))
      .filter(Boolean);
    tcpaMap = Object.fromEntries(tcpaCases.map((c) => [c.id, c]));
    tcpaScored = tcpaCases.map((tc) => {
      const r = scoreTcpaPair(client, tc);
      return {
        id: tc.id,
        ...r,
        reason: summarizeRules(r),
        kind: "tcpa",
      };
    });
  }

  // ── Score against legacy leads ────────────────────────────────────────────
  let leadScored = [];
  let leadMap = {};
  if (caseType !== "TCPA") {
    const leadIds = await kv.zrange("leads_by_score", 0, -1, { rev: true }).catch(() => []);
    const topIds = leadIds.slice(0, 50);
    const leads = (await Promise.all(topIds.map((id) => kv.get(`lead:${id}`))))
      .map((r) => (r ? (typeof r === "string" ? JSON.parse(r) : r) : null))
      .filter(Boolean);
    leadMap = Object.fromEntries(leads.map((l) => [l.id, l]));

    const clientProfile = `Client: ${client.firstName} ${client.lastName}
State: ${client.state || "Unknown"}
Age: ${client.age || "Unknown"}
Injuries/Conditions: ${client.injuries || "None listed"}
Products Used: ${client.productsUsed || "None listed"}
Medications: ${client.medicationsUsed || "None listed"}
Exposure Period: ${client.exposurePeriod || "Unknown"}
Occupation: ${client.occupation || "Unknown"}
Original Case Type: ${client.originalCaseType || "Unknown"}
Notes: ${(client.caseNotes || "").slice(0, 300)}`;

    const system = `You are a plaintiff intake specialist. Given a client profile, score each potential class action case for how well the client qualifies as a plaintiff. Return ONLY a JSON array.`;

    const leadBatches = [];
    for (let i = 0; i < leads.length; i += BATCH) leadBatches.push(leads.slice(i, i + BATCH));

    const allResults = await Promise.all(leadBatches.map((batch) => {
      const caseList = batch.map((l) => {
        const a = l.analysis || {};
        return {
          id: l.id,
          title: a.headline || l.title,
          caseType: a.caseType,
          requiredInjury: a.plaintiffProfile?.requiredInjury,
          product: a.plaintiffProfile?.productOrMedication || a.plaintiffProfile?.acquisitionHook,
          demographics: a.plaintiffProfile?.demographics,
          disqualifiers: a.plaintiffProfile?.disqualifiers,
          geography: a.classProfile?.geographicScope,
        };
      });
      return claudeJSON(
        [{
          role: "user",
          content: `CLIENT PROFILE:\n${clientProfile}\n\nCASES TO EVALUATE:\n${JSON.stringify(caseList, null, 1)}\n\nReturn JSON array:\n[{"id":"lead_id","score":0-100,"qualifies":true/false,"reason":"one sentence"}]`,
        }],
        system,
        1500
      );
    }));
    leadScored = allResults.flat()
      .filter((r) => r && r.id && typeof r.score === "number")
      .map((r) => ({ ...r, kind: "lead", confidenceSource: "haiku" }));
  }

  // ── Merge, sort, return ───────────────────────────────────────────────────
  const merged = [...tcpaScored, ...leadScored]
    .filter((r) => r && r.id && typeof r.score === "number")
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const enriched = merged.map((s) => ({
    ...s,
    case: s.kind === "tcpa" ? tcpaMap[s.id] : null,
    lead: s.kind === "lead" ? leadMap[s.id] : null,
  })).filter((s) => s.case || s.lead);

  return {
    status: 200,
    body: {
      clientId,
      client,
      matches: enriched,
      total: tcpaScored.length + leadScored.length,
    },
  };
}

// ── HTTP entrypoint ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { mode, caseId, clientId, caseType = "AUTO", firmFilter, topN } = req.body || {};

  try {
    if (mode === "case-to-clients" || (caseId && !clientId)) {
      const { status, body } = await handleCaseToClients({ caseId, caseType, firmFilter });
      return res.status(status).json(body);
    }
    if (mode === "client-to-cases" || (clientId && !caseId)) {
      const { status, body } = await handleClientToCases({ clientId, caseType, topN });
      return res.status(status).json(body);
    }
    return res.status(400).json({ error: "must provide caseId (case-to-clients) or clientId (client-to-cases)" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "match-cases failed" });
  }
}

// Exported for the api/match-clients.js shim.
export { handleCaseToClients, handleClientToCases };
