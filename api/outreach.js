// Vercel serverless function — stream a personalized client outreach letter
// POST /api/outreach  { client: {...}, lead: {...} }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FIRM_PHONE = process.env.FIRM_PHONE || "(800) 555-0100";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { client, lead } = req.body || {};
  if (!client || !lead) return res.status(400).json({ error: "client and lead required" });

  const a = lead.analysis || {};
  const urgencyLevel = a.timeline?.urgencyLevel || a.urgencyLevel || "";
  const isUrgent = ["HIGH", "CRITICAL"].includes((urgencyLevel || "").toUpperCase());

  const clientProfile = [
    client.injuries && `Injuries/conditions: ${client.injuries}`,
    client.medicationsUsed && `Medications: ${client.medicationsUsed}`,
    client.productsUsed && `Products/devices used: ${client.productsUsed}`,
    client.exposurePeriod && `Exposure period: ${client.exposurePeriod}`,
    client.state && `State: ${client.state}`,
    client.age && `Age: ${client.age}`,
    client.occupation && `Occupation: ${client.occupation}`,
  ].filter(Boolean).join("\n");

  const leadSummary = [
    a.headline && `Case: ${a.headline}`,
    a.caseType && `Case type: ${a.caseType}`,
    a.defendantProfile?.name && `Defendant: ${a.defendantProfile.name}`,
    a.plaintiffProfile?.requiredInjury && `Required injury: ${a.plaintiffProfile.requiredInjury}`,
    a.damagesModel?.perClaimantRange && `Estimated compensation: ${a.damagesModel.perClaimantRange}`,
    isUrgent && `Urgency: ${urgencyLevel}`,
    isUrgent && a.timeline?.urgencyReason && `Urgency reason: ${a.timeline.urgencyReason}`,
    isUrgent && a.timeline?.statuteOfLimitationsNote && `Statute of limitations: ${a.timeline.statuteOfLimitationsNote}`,
  ].filter(Boolean).join("\n");

  const systemPrompt = "You are a plaintiff attorney drafting a personalized client outreach letter.";

  const userPrompt = `Draft a personalized outreach letter to ${client.firstName || "the client"} ${client.lastName || ""} from a plaintiff law firm.

CLIENT PROFILE:
${clientProfile || "Profile data not available"}

PRIOR FIRM RELATIONSHIP:
The client was previously represented by or had contact with: ${client.sourceFirm || "a prior law firm"}

CASE / LEAD INFORMATION:
${leadSummary || "A new class action case that may affect this client"}

INSTRUCTIONS:
1. Begin with a professional subject line: "Subject: [subject line]"
2. Write the body of the letter (250–350 words total, not counting the subject line)
3. Open warmly, reference their prior relationship with ${client.sourceFirm || "their prior firm"}
4. Explain a new class action case has emerged that may affect them specifically
5. Based on their profile (injuries, medications, products used), explain why they may qualify
6. Describe what the case is about: the defendant, the type of harm, and the estimated compensation range
7. Include a clear call to action: call us at ${FIRM_PHONE} or reply to this message to schedule a free consultation
8. Use plain, accessible language — no legalese. Professional but warm tone.
9. Do not be spammy or use high-pressure sales tactics.${isUrgent ? `
10. Include a brief but clear note about statute of limitations urgency — they need to act promptly or may lose their right to recover.` : ""}

Do not include a signature block placeholder — end the letter at the closing.`;

  // Stream the letter back
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        stream: true,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      res.write(`data: ${JSON.stringify({ type: "error", error: { message: `Anthropic ${upstream.status}: ${txt.slice(0, 200)}` } })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: "error", error: { message: e.message } })}\n\n`);
    res.end();
  }
}
