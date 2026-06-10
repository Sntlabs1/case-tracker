// Vercel serverless — Haiku-powered defendant entity resolution.
//
// POST /api/resolve-defendant
// Body: { name: "Capital One Bank, N.A.", autoMerge?: true }
//
// Strategy:
//   1. defendantResolver.resolveOrSuggest() handles exact + high-similarity hits without an API call
//   2. If still ambiguous, ask Haiku to pick the best canonical match from the candidate set
//   3. If autoMerge=true and Haiku confidence >= 0.85, link the alias and return canonicalId
//      otherwise return { needsReview: true, candidates, haikuOpinion }
//
// This endpoint is called from api/tcpa-cases.js bulk imports only when the
// determinstic resolver returns needsReview. Most defendant resolution should
// stay in defendantResolver.js (no API spend).

import {
  resolveOrSuggest,
  findCandidates,
  addAlias,
  createDefendant,
} from "../src/lib/ingest/defendantResolver.js";

const HAIKU = "claude-haiku-4-5-20251001";

async function haikuPickMatch(rawName, candidates) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const system = `You disambiguate corporate defendant names. Given a raw name and a list of canonical candidates, decide which canonical entity (if any) the raw name refers to.

Return ONLY a JSON object:
{
  "canonicalId": "<id from candidates list, or null if none match>",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}

Confidence rubric:
- 0.95+ : Same legal entity beyond doubt (e.g., "Capital One Bank, N.A." vs "Capital One Bank, N.A." with different formatting)
- 0.85-0.94 : Same parent/subsidiary family, name variation
- 0.70-0.84 : Likely same but ambiguous (could be different subsidiary)
- < 0.70 : Different entities OR insufficient info — return null canonicalId`;

    const userMsg = `Raw name: "${rawName}"

Candidates:
${candidates.map((c, i) => `${i + 1}. canonicalId="${c.canonicalId}", displayName="${c.displayName}", trigramSimilarity=${c.similarity.toFixed(2)}`).join("\n")}

Which canonical entity does the raw name refer to? Return JSON only.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    const raw = d.content?.[0]?.text || "{}";
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { name, autoMerge = true, autoCreateOnMiss = false, autoMergeThreshold = 0.85 } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  // Step 1: deterministic resolver
  const sug = await resolveOrSuggest(name);
  if (sug.canonicalId) {
    return res.status(200).json({
      canonicalId: sug.canonicalId,
      source: sug.source,
      similarity: sug.similarity ?? 1,
    });
  }

  // Step 2: Haiku judgment over top candidates
  const candidates = sug.candidates || (await findCandidates(name, 5));
  if (!candidates.length) {
    if (autoCreateOnMiss) {
      const created = await createDefendant({ displayName: name });
      return res.status(200).json({
        canonicalId: created.canonicalId,
        source: "created",
      });
    }
    return res.status(200).json({
      needsReview: true,
      reason: "no_candidates",
      candidates: [],
    });
  }

  const opinion = await haikuPickMatch(name, candidates);
  if (!opinion) {
    return res.status(200).json({
      needsReview: true,
      reason: "haiku_unavailable",
      candidates,
    });
  }

  if (autoMerge && opinion.canonicalId && opinion.confidence >= autoMergeThreshold) {
    const valid = candidates.find((c) => c.canonicalId === opinion.canonicalId);
    if (valid) {
      await addAlias(opinion.canonicalId, name);
      return res.status(200).json({
        canonicalId: opinion.canonicalId,
        source: "haiku",
        confidence: opinion.confidence,
        reasoning: opinion.reasoning,
      });
    }
  }

  return res.status(200).json({
    needsReview: true,
    reason: "low_confidence",
    candidates,
    haikuOpinion: opinion,
  });
}
