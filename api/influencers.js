// Vercel serverless function — targeted influencer identification + scoring for case outreach
// POST /api/influencers  { leadId, title, category, description, caseType, plaintiffProfile, geography }

import { kv } from "@vercel/kv";

const SB_CLIENT = process.env.SOCIAL_BLADE_CLIENT;
const SB_TOKEN  = process.env.SOCIAL_BLADE_TOKEN;
const SB_BASE   = "https://matrix.sbapis.com/b";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function formatNum(n) {
  if (!n || isNaN(n)) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function platformUrl(platform, username) {
  const u = encodeURIComponent(username);
  switch (platform) {
    case "youtube":   return `https://youtube.com/@${username}`;
    case "tiktok":    return `https://tiktok.com/@${username}`;
    case "instagram": return `https://instagram.com/${username}`;
    case "twitter":   return `https://twitter.com/${username}`;
    default:          return `https://${platform}.com/${username}`;
  }
}

// Look up a specific creator on Social Blade — uses 1 credit
async function sbStats(platform, username) {
  try {
    const url = `${SB_BASE}/${platform}/statistics?query=${encodeURIComponent(username)}`;
    const res = await fetch(url, {
      headers: { clientid: SB_CLIENT, token: SB_TOKEN },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const d = data?.data;
    if (!d) return null;
    const stats = d.statistics?.total || {};
    const daily = d.statistics?.daily || {};
    const monthly = d.statistics?.monthly || {};
    const followers = stats.subscribers ?? stats.followers ?? stats.fans ?? 0;
    const dailyGrowth = daily.subscribers ?? daily.followers ?? 0;
    const engagementRate = followers > 0 && monthly.views
      ? ((monthly.views / followers) * 100).toFixed(1)
      : null;
    return {
      verified: true,
      username:    d.username || username,
      displayName: d.display_name || d.username || username,
      avatar:      d.avatar || null,
      followers,
      followersFormatted: formatNum(followers),
      totalViews:  stats.views ?? 0,
      uploads:     stats.uploads ?? null,
      dailyGrowth,
      dailyGrowthFormatted: dailyGrowth != null ? (dailyGrowth >= 0 ? "+" : "") + formatNum(Math.abs(dailyGrowth)) + "/day" : null,
      monthlyViews: monthly.views ?? null,
      engagementRate,
      grade:       d.grade || null,
      country:     d.country || null,
      email:       d.email || null,
      website:     d.links?.website || null,
      twitter:     d.links?.twitter || null,
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { leadId, title, category, description, caseType, plaintiffProfile, geography } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });

  if (!SB_CLIENT || !SB_TOKEN) {
    return res.status(500).json({ error: "Social Blade credentials not configured." });
  }

  // KV cache — 24h to conserve Social Blade credits
  const cacheKey = `influencers_v2_${leadId || Buffer.from(title).toString("base64").slice(0, 20)}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json({ ...JSON.parse(cached), cached: true });
  } catch {}

  // ── STEP 1: Claude Sonnet identifies specific real influencers ────────────────
  // Uses knowledge of actual creators — much more targeted than keyword search
  const caseContext = [
    `Case: ${title}`,
    `Category: ${category || "Unknown"}`,
    `Case Type: ${caseType || "Unknown"}`,
    `Summary: ${(description || "").slice(0, 500)}`,
    plaintiffProfile ? `Plaintiff Profile: ${plaintiffProfile}` : "",
    geography ? `Key Geography: ${geography}` : "",
  ].filter(Boolean).join("\n");

  let candidates = [];
  let outreachScript = "";
  let strategyNote = "";

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        messages: [{
          role: "user",
          content: `You are a plaintiff acquisition strategist for a class action law firm. Identify SPECIFIC, REAL social media influencers to help recruit plaintiffs for this case.

${caseContext}

Identify 15 specific influencers across YouTube, TikTok, Instagram, and Twitter. These should be REAL creators you know — attorneys, patient advocates, consumer rights activists, health coaches, journalists, community leaders — whoever would authentically reach the victims of this specific case.

For each influencer, score them 0–100 on partnership fit using:
- nicheScore (0–30): How directly relevant is their content to this case and its victims?
- demographicScore (0–25): Does their audience match the likely plaintiff demographics (age, income, health status, profession, location)?
- geographicScore (0–20): Are they focused on the right geographic markets (state AG jurisdiction, affected regions)?
- reachScore (0–15): Estimated audience size and platform authority for plaintiff acquisition?
- toneScore (0–10): Advocacy-oriented, trusted by victims, appropriate credibility?

Return ONLY valid JSON (no markdown) with this exact structure:
{
  "strategyNote": "2-3 sentences on the overall influencer strategy for this case type",
  "outreachScript": "3-sentence DM/email pitch a law firm sends to request a partnership — include specific hook for this case",
  "candidates": [
    {
      "platform": "youtube|tiktok|instagram|twitter",
      "username": "exact_handle_without_@",
      "displayName": "Full Name or Channel Name",
      "estimatedFollowers": 250000,
      "niche": "personal injury law / opioid recovery / patient advocacy / etc",
      "whyTargeted": "2 sentences explaining why this specific creator fits this case — demographics, location, past content, audience",
      "demographics": "brief audience description (e.g. '35-55 female, Midwest, chronic pain patients')",
      "location": "primary geographic focus",
      "nicheScore": 28,
      "demographicScore": 22,
      "geographicScore": 15,
      "reachScore": 12,
      "toneScore": 9,
      "totalScore": 86,
      "partnershipTier": "Tier 1 — Primary Target|Tier 2 — Strong Fit|Tier 3 — Secondary"
    }
  ]
}`,
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    const cd = await claudeRes.json();
    const text = (cd.content?.[0]?.text || "{}").replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(text);
    candidates     = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    outreachScript = parsed.outreachScript || "";
    strategyNote   = parsed.strategyNote || "";
  } catch (e) {
    console.error("Claude influencer gen failed:", e.message);
    return res.status(500).json({ error: "Failed to generate influencer recommendations: " + e.message });
  }

  if (!candidates.length) {
    return res.status(200).json({ influencers: [], totalFound: 0, strategyNote, outreachScript, generatedAt: new Date().toISOString() });
  }

  // Sort by totalScore, verify top 8 on Social Blade (8 credits)
  candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

  // ── STEP 2: Verify top 8 on Social Blade for real-time stats ─────────────────
  const toVerify  = candidates.slice(0, 8);
  const remainder = candidates.slice(8);

  const verifyResults = await Promise.all(
    toVerify.map(c => sbStats(c.platform, c.username))
  );

  // Merge Social Blade data into candidates
  const influencers = candidates.map((c, i) => {
    const sbData = i < 8 ? verifyResults[i] : null;
    const followers = sbData?.followers ?? c.estimatedFollowers ?? 0;

    // Adjust reachScore if real follower data differs significantly from estimate
    let reachScore = c.reachScore || 0;
    if (sbData?.followers) {
      if (sbData.followers > 1_000_000) reachScore = 15;
      else if (sbData.followers > 500_000) reachScore = 13;
      else if (sbData.followers > 100_000) reachScore = 10;
      else if (sbData.followers > 50_000)  reachScore = 8;
      else reachScore = 5;
    }
    const adjustedTotal = (c.nicheScore || 0) + (c.demographicScore || 0) + (c.geographicScore || 0) + reachScore + (c.toneScore || 0);

    return {
      platform:       c.platform,
      username:       sbData?.username || c.username,
      displayName:    sbData?.displayName || c.displayName,
      avatar:         sbData?.avatar || null,
      profileUrl:     platformUrl(c.platform, c.username),
      niche:          c.niche,
      whyTargeted:    c.whyTargeted,
      demographics:   c.demographics,
      location:       c.location,
      partnershipTier: c.partnershipTier || "Tier 3 — Secondary",
      // Scoring
      scores: {
        niche:       c.nicheScore || 0,
        demographic: c.demographicScore || 0,
        geographic:  c.geographicScore || 0,
        reach:       reachScore,
        tone:        c.toneScore || 0,
        total:       adjustedTotal,
      },
      // Stats — real if verified, estimated otherwise
      verified:            !!sbData,
      followers,
      followersFormatted:  sbData?.followersFormatted || formatNum(followers) || "Unknown",
      dailyGrowth:         sbData?.dailyGrowth ?? null,
      dailyGrowthFormatted: sbData?.dailyGrowthFormatted || null,
      engagementRate:      sbData?.engagementRate || null,
      grade:               sbData?.grade || null,
      country:             sbData?.country || c.location || null,
      email:               sbData?.email || null,
      website:             sbData?.website || null,
    };
  });

  // Final sort by adjusted total score
  influencers.sort((a, b) => (b.scores.total || 0) - (a.scores.total || 0));

  const output = {
    strategyNote,
    outreachScript,
    influencers,
    totalFound: influencers.length,
    verifiedCount: verifyResults.filter(Boolean).length,
    generatedAt: new Date().toISOString(),
  };

  try {
    await kv.set(cacheKey, JSON.stringify(output), { ex: 86400 });
  } catch {}

  return res.status(200).json(output);
}
