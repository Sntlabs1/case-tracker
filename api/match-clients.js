// Vercel serverless — AI-powered client × lead matching engine
// POST /api/match-clients
// Body: { leadId: "...", firmFilter?: "..." }
//   OR: { clientId: "...", topN?: 10 }  — match one client against recent high-score leads

import { kv } from "@vercel/kv";

const HAIKU  = "claude-haiku-4-5-20251001";
const BATCH  = 20;           // clients per Haiku call
const MAX_CLIENTS = 2000;    // cap to control cost

async function claudeJSON(messages, system, maxTokens = 2000) {
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
  } catch { return []; }
  finally { clearTimeout(timeout); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { leadId, clientId, firmFilter, topN = 10 } = req.body || {};

  // ── Mode A: match all clients against one lead ─────────────────────────────
  if (leadId) {
    const rawLead = await kv.get(`lead:${leadId}`);
    if (!rawLead) return res.status(404).json({ error: "Lead not found" });
    const lead = typeof rawLead === "string" ? JSON.parse(rawLead) : rawLead;
    const a = lead.analysis || {};

    // Build concise plaintiff requirements for the prompt
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

    // Fetch clients (filtered by firm if requested)
    const ids = await kv.zrange("clients_by_date", 0, -1, { rev: true }).catch(() => []);
    const allClients = [];
    for (let i = 0; i < Math.min(ids.length, MAX_CLIENTS); i += 100) {
      const batch = await Promise.all(ids.slice(i, i + 100).map(id => kv.get(`client:${id}`)));
      batch.forEach(r => {
        if (!r) return;
        const c = typeof r === "string" ? JSON.parse(r) : r;
        if (firmFilter && c.sourceFirm !== firmFilter) return;
        allClients.push(c);
      });
    }

    if (!allClients.length) return res.status(200).json({ matches: [], leadId, total: 0 });

    // Build batches and run parallel Haiku scoring
    const system = `You are a plaintiff intake specialist for a class action law firm.
Score each client's eligibility for this specific case. Be strict — only score high if the client clearly meets the criteria.
Return ONLY a JSON array, no other text.`;

    const batches = [];
    for (let i = 0; i < allClients.length; i += BATCH) {
      batches.push(allClients.slice(i, i + BATCH));
    }

    const CONCURRENCY = 8;
    const allScored = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(wave.map(batch => {
        const clientList = batch.map((c, idx) => ({
          idx,
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
        return claudeJSON([{
          role: "user",
          content: `CASE REQUIREMENTS:\n${requirements}\n\nCLIENTS TO EVALUATE:\n${JSON.stringify(clientList, null, 1)}\n\nReturn JSON array with one object per client:\n[{"id":"client_id","score":0-100,"qualifies":true/false,"reason":"one sentence","matchingFactors":["..."],"disqualifyingFactors":["..."]}]`,
        }], system, 1500);
      }));
      results.forEach(r => allScored.push(...r));
    }

    // Sort by score descending, take top matches
    const scored = allScored
      .filter(r => r && r.id && typeof r.score === "number")
      .sort((a, b) => b.score - a.score);

    // Enrich with client metadata
    const clientMap = Object.fromEntries(allClients.map(c => [c.id, c]));
    const enriched = scored.map(s => ({
      ...s,
      client: clientMap[s.id] || null,
    })).filter(s => s.client);

    return res.status(200).json({
      leadId,
      leadTitle: a.headline || lead.title,
      matches: enriched,
      qualifying: enriched.filter(s => s.qualifies).length,
      total: allClients.length,
      scannedAt: new Date().toISOString(),
    });
  }

  // ── Mode B: match one client against recent high-score leads ───────────────
  if (clientId) {
    const rawClient = await kv.get(`client:${clientId}`);
    if (!rawClient) return res.status(404).json({ error: "Client not found" });
    const client = typeof rawClient === "string" ? JSON.parse(rawClient) : rawClient;

    // Fetch top high-score leads
    const ids = await kv.zrange("leads_by_score", 0, -1, { rev: true }).catch(() => []);
    const topIds = ids.slice(0, 50);
    const leads = (await Promise.all(topIds.map(id => kv.get(`lead:${id}`))))
      .map(r => r ? (typeof r === "string" ? JSON.parse(r) : r) : null)
      .filter(Boolean);

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

    const allResults = await Promise.all(leadBatches.map(batch => {
      const caseList = batch.map(l => {
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
      return claudeJSON([{
        role: "user",
        content: `CLIENT PROFILE:\n${clientProfile}\n\nCASES TO EVALUATE:\n${JSON.stringify(caseList, null, 1)}\n\nReturn JSON array:\n[{"id":"lead_id","score":0-100,"qualifies":true/false,"reason":"one sentence"}]`,
      }], system, 1500);
    }));

    const scored = allResults.flat()
      .filter(r => r && r.id && typeof r.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    const leadMap = Object.fromEntries(leads.map(l => [l.id, l]));
    const enriched = scored.map(s => ({ ...s, lead: leadMap[s.id] || null })).filter(s => s.lead);

    return res.status(200).json({ clientId, client, matches: enriched, total: leads.length });
  }

  return res.status(400).json({ error: "leadId or clientId required" });
}
