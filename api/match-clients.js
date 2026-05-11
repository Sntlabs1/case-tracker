// Vercel serverless — backward-compat shim for /api/match-clients.
//
// The actual matching logic lives in api/match-cases.js. Existing callers
// (Campaigns.jsx, Intake.jsx) post { leadId, ... } or { clientId, ... } and
// expect the legacy response shape. This shim translates to the generalized
// match-cases contract and forces caseType: "MASS_TORT" so behavior is
// unchanged for non-TCPA flows.
//
// New code should call /api/match-cases directly.

import { handleCaseToClients, handleClientToCases } from "./match-cases.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { leadId, clientId, firmFilter, topN = 10 } = req.body || {};

  try {
    if (leadId) {
      // Legacy: leadId is a non-TCPA case ID. Force MASS_TORT so the dispatcher
      // never accidentally routes a leadId starting with "tcpa_" to the rules
      // path — but match-cases.js would already reject that since lead: KV
      // namespace is separate. Belt and suspenders.
      const { status, body } = await handleCaseToClients({
        caseId: leadId,
        caseType: "MASS_TORT",
        firmFilter,
      });
      // Translate response shape: caseId/caseTitle → leadId/leadTitle
      const translated = body.error ? body : {
        leadId: body.caseId,
        leadTitle: body.caseTitle,
        matches: body.matches,
        qualifying: body.qualifying,
        total: body.total,
        scannedAt: body.scannedAt,
      };
      return res.status(status).json(translated);
    }

    if (clientId) {
      // Legacy mode B scored a client only against leads; preserve that exact
      // scope by passing caseType: "MASS_TORT".
      const { status, body } = await handleClientToCases({
        clientId,
        caseType: "MASS_TORT",
        topN,
      });
      // Translate matches[].lead is already present; fields align.
      return res.status(status).json(body);
    }

    return res.status(400).json({ error: "leadId or clientId required" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "match-clients failed" });
  }
}
