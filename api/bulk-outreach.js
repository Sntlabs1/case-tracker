// Vercel serverless — batch outreach letter generation
// POST /api/bulk-outreach { clients: [...], lead: {...} }
// Generates personalized letters for up to 10 clients per call using Haiku
// Returns { letters: [{ clientId, firstName, lastName, email, phone, state, letter, error }] }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FIRM_PHONE = process.env.FIRM_PHONE || "(800) 555-0100";
const FIRM_NAME  = process.env.FIRM_NAME  || "our firm";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { clients, lead } = req.body || {};
  if (!clients?.length || !lead) return res.status(400).json({ error: "clients and lead required" });

  const batch = clients.slice(0, 10);
  const a = lead.analysis || {};
  const urgencyLevel = (a.timeline?.urgencyLevel || "").toUpperCase();
  const isUrgent = ["HIGH", "CRITICAL"].includes(urgencyLevel);

  const leadContext = [
    a.headline          && `Case: ${a.headline}`,
    a.caseType          && `Case type: ${a.caseType}`,
    a.defendantProfile?.name && `Defendant: ${a.defendantProfile.name}`,
    a.plaintiffProfile?.requiredInjury && `Required injury: ${a.plaintiffProfile.requiredInjury}`,
    a.damagesModel?.perClaimantRange && `Estimated compensation: ${a.damagesModel.perClaimantRange}`,
    isUrgent && `URGENT — ${a.timeline?.statuteOfLimitationsNote || "Act promptly — statute of limitations applies"}`,
  ].filter(Boolean).join("\n");

  const clientList = batch.map((c, i) => {
    const profile = [
      c.injuries        && `Injuries: ${c.injuries.slice(0, 120)}`,
      c.medicationsUsed && `Medications: ${c.medicationsUsed.slice(0, 80)}`,
      c.productsUsed    && `Products: ${c.productsUsed.slice(0, 80)}`,
      c.state           && `State: ${c.state}`,
      c.age             && `Age: ${c.age}`,
      c.sourceFirm      && `Prior firm: ${c.sourceFirm}`,
    ].filter(Boolean).join("; ");
    return `[${i}] ID:${c.id} | ${c.firstName || "Client"} ${c.lastName || ""} | ${profile}`;
  }).join("\n");

  const prompt = `You are a plaintiff attorney writing personalized outreach letters for a potential class action.

CASE INFORMATION:
${leadContext}

FIRM PHONE: ${FIRM_PHONE}
FIRM NAME: ${FIRM_NAME}

For each client below, write a personalized outreach letter. Each letter must:
- Start with "Subject: [subject line]" on its own line
- Be 220–300 words (not counting subject line)
- Open warmly, mention they were previously represented by or had contact with their prior firm
- Explain why their specific profile (injuries/medications/products) may qualify them for this case
- Describe the defendant, the harm, and the estimated compensation range
- End with: call ${FIRM_PHONE} or reply to schedule a FREE consultation
- Professional and warm tone — no legalese, no high-pressure tactics${isUrgent ? "\n- Include one sentence about statute of limitations — they must act soon or may lose their right to recover" : ""}

CLIENTS:
${clientList}

Return ONLY a valid JSON array, no markdown, no commentary. Format:
[{"index":0,"clientId":"<exact id from ID: field>","letter":"<full letter text>"},...]

Generate exactly ${batch.length} letters, one per client.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(502).json({ error: `Anthropic ${resp.status}: ${txt.slice(0, 200)}` });
    }

    const data = await resp.json();
    const text = data.content?.map(b => b.text || "").join("") || "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array in LLM response");

    let rawLetters;
    try { rawLetters = JSON.parse(match[0]); }
    catch { throw new Error("Failed to parse letters JSON"); }

    // Map back to clients — match by index or clientId
    const letters = batch.map((c, i) => {
      const found = rawLetters.find(l => l.clientId === c.id || l.index === i);
      return {
        clientId:  c.id,
        firstName: c.firstName || "",
        lastName:  c.lastName  || "",
        email:     c.email     || "",
        phone:     c.phone     || "",
        state:     c.state     || "",
        letter:    found?.letter || "",
        error:     found?.letter ? null : "Generation failed for this client",
      };
    });

    return res.status(200).json({ letters });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
