// GET /api/intake-questions?id=<clientId>          full questionnaire for one claimant
// GET /api/intake-questions?id=<clientId>&format=text   flattened, ready-to-send text
//
// Turns a (possibly thin/incomplete) client:* record into the client-ready
// questions needed to confirm whether they can claim against each connected
// defendant. The missing facts ARE the questions; works on any record that has
// at least one case connection.

import { kv } from "@vercel/kv";
import { buildIntakeQuestionnaire, flattenQuestionnaire } from "./_lib/intakeQuestions.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id, format } = req.query;
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > 64) {
    return res.status(400).json({ error: "Invalid or missing id" });
  }

  try {
    const raw = await kv.get(`client:${id}`);
    if (!raw) return res.status(404).json({ error: "Client not found" });
    const client = typeof raw === "string" ? JSON.parse(raw) : raw;

    const questionnaire = buildIntakeQuestionnaire(client);
    if (questionnaire.connectionCount === 0) {
      return res.status(200).json({
        claimantId: id,
        message: "No case connections on this record — no questionnaire to generate.",
        connectionCount: 0,
      });
    }

    if (format === "text") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(flattenQuestionnaire(questionnaire));
    }
    return res.status(200).json(questionnaire);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
