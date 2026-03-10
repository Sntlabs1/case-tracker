// Vercel serverless function — find influencers for a case lead via Social Blade
// POST /api/influencers  { leadId, title, category, description, caseType }

import { kv } from "@vercel/kv";

const SB_CLIENT = process.env.SOCIAL_BLADE_CLIENT;
const SB_TOKEN  = process.env.SOCIAL_BLADE_TOKEN;
const SB_BASE   = "https://matrix.sbapis.com/b";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function sbHeaders() {
  return { clientid: SB_CLIENT, token: SB_TOKEN };
}

function platformUrl(platform, username) {
  switch (platform) {
    case "youtube":   return `https://youtube.com/@${username}`;
    case "tiktok":    return `https://tiktok.com/@${username}`;
    case "instagram": return `https://instagram.com/${username}`;
    case "twitter":   return `https://twitter.com/${username}`;
    default:          return `https://${platform}.com/${username}`;
  }
}

function formatNum(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

async function sbSearch(platform, query) {
  try {
    const url = `${SB_BASE}/${platform}/search?query=${encodeURIComponent(query)}&limit=8`;
    const res = await fetch(url, {
      headers: sbHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`SB ${platform} search [${query}]: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const items = data?.data?.items || [];
    return items.map(item => {
      const stats = item.statistics?.total || {};
      const daily = item.statistics?.daily || {};
      const monthly = item.statistics?.monthly || {};
      const followers = stats.subscribers ?? stats.followers ?? stats.fans ?? 0;
      const dailyGrowth = daily.subscribers ?? daily.followers ?? 0;
      const monthlyViews = monthly.views ?? 0;
      return {
        platform,
        id:          item.id || item.user_id || "",
        username:    item.username || item.user_id || "",
        displayName: item.display_name || item.username || "",
        avatar:      item.avatar || null,
        followers,
        followersFormatted: formatNum(followers),
        totalViews:  stats.views ?? 0,
        dailyGrowth,
        dailyGrowthFormatted: (dailyGrowth >= 0 ? "+" : "") + formatNum(dailyGrowth) + "/day",
        monthlyViews,
        grade:       item.grade || "N/A",
        profileUrl:  platformUrl(platform, item.username || item.user_id),
        country:     item.country || null,
        // contact hints — Social Blade surfaces these when available
        email:       item.email || null,
        website:     item.links?.website || null,
      };
    });
  } catch (e) {
    console.error(`SB ${platform} search error:`, e.message);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { leadId, title, category, description, caseType } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });

  if (!SB_CLIENT || !SB_TOKEN) {
    return res.status(500).json({ error: "Social Blade credentials not configured. Add SOCIAL_BLADE_CLIENT and SOCIAL_BLADE_TOKEN to Vercel env vars." });
  }

  // Check KV cache — 24h TTL to conserve Social Blade credits
  const cacheKey = `influencers_${leadId || Buffer.from(title).toString("base64").slice(0, 20)}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json({ ...JSON.parse(cached), cached: true });
  } catch {}

  // Step 1: Use Claude Haiku to generate targeted search queries
  let queries   = [];
  let platforms = ["youtube", "tiktok", "instagram"];
  let niche     = "";
  let outreachScript = "";

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: `You are helping a plaintiff class action law firm find social media influencers to recruit clients.

Case: ${title}
Category: ${category || ""}
Type: ${caseType || ""}
Summary: ${(description || "").slice(0, 400)}

Return ONLY a valid JSON object (no markdown, no explanation) with these exact keys:
- "queries": array of exactly 3 short search terms to find relevant content creators (e.g. "personal injury attorney", "drug side effects victims", "data breach privacy")
- "platforms": array of 2-3 platforms from ["youtube","tiktok","instagram","twitter"] best for reaching victims of this type of case
- "niche": one sentence describing the ideal influencer type for recruiting plaintiffs
- "outreachScript": 2-sentence DM pitch a law firm could send to an influencer asking them to share about the case`,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const cd = await claudeRes.json();
    const text = (cd.content?.[0]?.text || "{}").replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(text);
    queries        = Array.isArray(parsed.queries)   ? parsed.queries.slice(0, 3)   : [];
    platforms      = Array.isArray(parsed.platforms) ? parsed.platforms.slice(0, 3) : ["youtube", "tiktok"];
    niche          = parsed.niche || "";
    outreachScript = parsed.outreachScript || "";
  } catch (e) {
    console.error("Claude query gen failed:", e.message);
  }

  if (!queries.length) {
    queries = [title.slice(0, 50), (category || "class action").slice(0, 40)];
  }

  // Step 2: Search Social Blade — top 2 queries × top 3 platforms (6 credit uses)
  const searchJobs = [];
  for (const platform of platforms.slice(0, 3)) {
    for (const q of queries.slice(0, 2)) {
      searchJobs.push(sbSearch(platform, q));
    }
  }
  const searchResults = await Promise.all(searchJobs);
  let influencers = searchResults.flat();

  // Deduplicate by platform:username
  const seen = new Set();
  influencers = influencers.filter(i => {
    const key = `${i.platform}:${i.username}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by followers descending, take top 20
  influencers.sort((a, b) => b.followers - a.followers);
  influencers = influencers.slice(0, 20);

  // Group by platform
  const byPlatform = {};
  for (const inf of influencers) {
    if (!byPlatform[inf.platform]) byPlatform[inf.platform] = [];
    byPlatform[inf.platform].push(inf);
  }

  const output = {
    niche,
    outreachScript,
    queries,
    platforms,
    influencers,
    byPlatform,
    totalFound: influencers.length,
    generatedAt: new Date().toISOString(),
  };

  // Cache for 24h
  try {
    await kv.set(cacheKey, JSON.stringify(output), { ex: 86400 });
  } catch {}

  return res.status(200).json(output);
}
