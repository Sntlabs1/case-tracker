// Claim deadline alert agent.
// Runs daily — finds claims where claimWindowCloses is within 7, 14, or 30 days
// and haven't been submitted yet. Writes alerts to tcpa:alerts:${clientId} so
// Pending Outreach tab surfaces them, and logs a summary to KV for the dashboard.

import { kv } from "@vercel/kv";

const THRESHOLDS = [7, 14, 30]; // days before deadline to alert

export async function run({ max = 5000 } = {}) {
  const now = Date.now();
  const horizon = now + 35 * 24 * 3600 * 1000; // fetch 35 days out (covers 30-day threshold + buffer)

  // Pull all claims with deadlines in the next 35 days
  const ids = await kv.zrangebyscore("claims_deadlines", now, horizon, { count: max }).catch(() => []);
  if (!ids.length) return { checked: 0, alerted: 0, overdue: 0 };

  const raws = await Promise.all(ids.map(id => kv.get(`claim:${id}`).catch(() => null)));
  const claims = raws.filter(Boolean).map(r => typeof r === "string" ? JSON.parse(r) : r);

  let alerted = 0;
  let overdue = 0;
  const summary = [];

  for (const claim of claims) {
    // Only alert on claims that haven't been submitted
    if (["submitted", "confirmed", "paid", "rejected", "dismissed"].includes(claim.status)) continue;

    const deadline = Date.parse(claim.claimWindowCloses);
    if (isNaN(deadline)) continue;

    const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      overdue++;
      // Mark as missed if still identified/drafted
      if (claim.status === "identified" || claim.status === "drafted") {
        await kv.set(`claim:${claim.id}`, JSON.stringify({
          ...claim,
          status: "dismissed",
          notes: (claim.notes || "") + `\nAuto-dismissed: claim window closed ${claim.claimWindowCloses}.`,
          updatedAt: new Date().toISOString(),
        }), { ex: 3 * 365 * 24 * 3600 }).catch(() => {});
      }
      continue;
    }

    const triggered = THRESHOLDS.filter(t => daysLeft <= t);
    if (!triggered.length) continue;

    const urgency = daysLeft <= 7 ? "critical" : daysLeft <= 14 ? "high" : "medium";
    const alertKey = `tcpa:claim_alert:${claim.id}:${daysLeft <= 7 ? "7" : daysLeft <= 14 ? "14" : "30"}`;

    // Idempotent — don't re-alert if already sent for this threshold
    const alreadySent = await kv.get(alertKey).catch(() => null);
    if (alreadySent) continue;

    const alert = {
      type: "claim_deadline",
      urgency,
      claimId:    claim.id,
      caseId:     claim.caseId,
      clientId:   claim.clientId,
      clientName: claim.clientName,
      caseCaption: claim.caseCaption,
      defendant:  claim.defendant,
      daysLeft,
      claimWindowCloses: claim.claimWindowCloses,
      claimPortalUrl: claim.claimPortalUrl,
      estimatedPayout: claim.estimatedPayout,
      message: `Claim window closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — ${claim.caseCaption}`,
      createdAt: new Date().toISOString(),
    };

    // Write alert to client's alert queue (Pending Outreach reads this)
    await kv.zadd(`tcpa:client_alerts:${claim.clientId}`, {
      score: Date.now(),
      member: JSON.stringify(alert),
    }).catch(() => {});

    // Mark this threshold as notified (TTL = 35 days)
    await kv.set(alertKey, "1", { ex: 35 * 24 * 3600 }).catch(() => {});

    alerted++;
    summary.push({ clientName: claim.clientName, caseCaption: claim.caseCaption, daysLeft, urgency });
  }

  const result = { checked: claims.length, alerted, overdue, summary: summary.slice(0, 20) };
  await kv.set("tcpa:agent:claim-deadline-alert:last", JSON.stringify({ ...result, ranAt: new Date().toISOString() }), { ex: 7 * 24 * 3600 }).catch(() => {});
  return result;
}
