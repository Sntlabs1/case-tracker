// Vercel serverless function — triggered daily by cron (vercel.json)
// Also callable manually: GET /api/scan
// Fetches 50+ sources, deduplicates, two-pass Claude analysis, stores in Vercel KV

import Parser from "rss-parser";
import { createHash } from "crypto";
import { kv } from "@vercel/kv";
import { QUICK_TRIAGE_PROMPT, DEEP_ANALYSIS_PROMPT } from "../src/lib/kbRubric.js";

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const YOUTUBE_API_KEY    = process.env.YOUTUBE_API_KEY;    // optional
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN; // optional — X API v2

const TIMEOUT_MS = 12000;
const TRIAGE_THRESHOLD = 55; // only deep-analyze items that score >= this

// ─── SOURCE DEFINITIONS ──────────────────────────────────────────────────────

const GOV_RSS_FEEDS = [
  // FDA
  { name: "FDA Recalls",          url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml",                   category: "Federal" },
  { name: "FDA Safety Alerts",    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml",                      category: "Federal" },
  { name: "FDA Drug Safety",      url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drug-safety-podcast/rss.xml",       category: "Federal" },
  // CPSC, USDA
  { name: "CPSC Recalls",         url: "https://www.cpsc.gov/Recalls.rss",                                                                     category: "Federal" },
  { name: "FSIS Food Recalls",    url: "https://www.fsis.usda.gov/rss/recalls.xml",                                                            category: "Federal" },
  // SEC, FTC
  { name: "SEC Litigation",       url: "https://www.sec.gov/rss/litigation/litreleases.xml",                                                   category: "Federal" },
  { name: "SEC Enforcement",      url: "https://www.sec.gov/rss/divisions/enforce/administrativeproceedings.xml",                              category: "Federal" },
  { name: "FTC Actions",          url: "https://www.ftc.gov/rss.xml",                                                                          category: "Federal" },
  // DOJ, EEOC, DOL, HHS
  { name: "DOJ Press Releases",   url: "https://www.justice.gov/news/rss",                                                                     category: "Federal" },
  { name: "EEOC News",            url: "https://www.eeoc.gov/rss/newsroom",                                                                    category: "Federal" },
  { name: "DOL News",             url: "https://blog.dol.gov/rss.xml",                                                                         category: "Federal" },
  { name: "HHS News",             url: "https://www.hhs.gov/rss/news.xml",                                                                     category: "Federal" },
  // CFPB
  { name: "CFPB",                 url: "https://www.consumerfinance.gov/about-us/newsroom/feed/",                                              category: "Federal" },
  // Courts
  { name: "JPML MDL Orders",      url: "https://ecf.jpml.uscourts.gov/cgi-bin/rss_outside.pl",                                                category: "Judicial" },
  // Plaintiff firm intelligence
  { name: "Miller & Zois Blog",   url: "https://www.millerandzois.com/blog/feed/atom/",                                                        category: "Plaintiff Firm" },
];

const GOOGLE_NEWS_QUERIES = [
  // Existing
  "class action lawsuit filed",
  "MDL mass tort consolidation",
  "product recall injury lawsuit",
  "pharmaceutical drug lawsuit FDA",
  "data breach settlement class action",
  "auto defect recall NHTSA",
  "PFAS toxic contamination lawsuit",
  "securities fraud class action filed",
  // Regulatory enforcement
  "NHTSA investigation safety defect 2026",
  "state attorney general lawsuit consumer protection 2026",
  "FDA warning letter recall enforcement 2026",
  "DOJ investigation corporate fraud consumer harm 2026",
  "EEOC discrimination class action 2026",
  "OSHA workplace injury violation 2026",
  // Emerging case types
  "social media addiction mental health lawsuit 2026",
  "cryptocurrency fraud investor class action 2026",
  "AI artificial intelligence discrimination lawsuit 2026",
  "gig worker employee misclassification lawsuit 2026",
  "PFAS firefighting foam contamination lawsuit 2026",
  "talcum powder asbestos lawsuit 2026",
  "nursing home neglect abuse lawsuit 2026",
  "insulin pricing antitrust class action 2026",
  "toxic baby food heavy metals lawsuit 2026",
  "rideshare sexual assault class action 2026",
  "data broker privacy class action 2026",
  // Social/consumer signals
  "mass complaints product injury viral 2026",
  "whistleblower complaint FDA corporate fraud 2026",
  "internal documents leak corporate harm 2026",
  "product liability wrongful death settlement 2026",

  // DOJ criminal enforcement → civil plaintiff pipeline
  "DOJ criminal fraud conviction company executives guilty plea victims civil lawsuit 2026",
  "criminal plea agreement corporate fraud consumer patients investors victims compensation 2026",
  "False Claims Act qui tam whistleblower settlement healthcare hospital fraud 2026",

  // State AG investigations (top plaintiff states)
  "California attorney general investigation enforcement action corporate fraud 2026",
  "New York attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Texas attorney general enforcement action consumer fraud 2026",
  "Florida attorney general investigation enforcement fraud consumers 2026",
  "multistate attorney general coalition investigation corporate fraud settlement 2026",

  // State AG investigations — individual states (25 largest by litigation activity)
  "Illinois attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Pennsylvania attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Ohio attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Michigan attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Washington state attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Massachusetts attorney general investigation enforcement consumer fraud lawsuit 2026",
  "New Jersey attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Colorado attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Minnesota attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Connecticut attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Maryland attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Virginia attorney general investigation enforcement consumer fraud lawsuit 2026",
  "North Carolina attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Georgia attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Arizona attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Wisconsin attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Oregon attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Nevada attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Missouri attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Indiana attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Tennessee attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Louisiana attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Kentucky attorney general investigation enforcement consumer fraud lawsuit 2026",
  "South Carolina attorney general investigation enforcement consumer fraud lawsuit 2026",
  "Alabama attorney general investigation enforcement consumer fraud lawsuit 2026",

  // State AG regional groupings — remaining 21 states
  "Iowa Nebraska Kansas Arkansas Oklahoma state attorney general investigation enforcement 2026",
  "Utah Idaho Montana Wyoming South Dakota North Dakota state attorney general enforcement 2026",
  "New Mexico West Virginia Mississippi Hawaii state attorney general investigation fraud 2026",
  "Maine New Hampshire Vermont Rhode Island Delaware Alaska state attorney general enforcement 2026",

  // SEC / securities class action
  "accounting restatement prior earnings reduced securities class action investor loss 2026",
  "material weakness internal controls restatement securities fraud investor lawsuit 2026",
  "company disclosed SEC subpoena investigation 8-K securities class action filed 2026",
  "securities fraud stock drop class action complaint filed site:securities.stanford.edu 2026",
  "NT 10-K late SEC filing restatement securities fraud class action 2026",

  // Plaintiff firm intelligence sites
  "site:millerandzois.com settlement verdict product liability pharmaceutical 2026",
  "site:classaction.com new investigation lawsuit consumer automobile drugs 2026",
  "site:classaction.com new investigation medical devices tech environmental 2026",
];

// Keyword-filtered subs — already mentioning legal action
const REDDIT_SUBS = [
  "legaladvice", "legal", "AskLawyers",
  "personalfinance", "financialindependence", "investing", "Accounting",
  "medicine", "AskDocs", "diabetes", "cancer", "nursing",
  "news", "worldnews", "technology",
  "ConsumerReports", "privacy",
  "WorkReform", "antiwork",
  "environment", "MechanicAdvice",
];

const REDDIT_KEYWORDS = [
  "recall", "lawsuit", "class action", "mdl", "settlement", "injury", "defective",
  "toxic", "fraud", "compensation", "contaminated", "misrepresented", "overcharged",
  "discrimination", "harassment", "adverse reaction", "side effects", "malfunction",
  "dangerous", "unsafe", "cover up", "whistleblower", "attorney", "mass tort",
  "personal injury", "product liability", "negligence", "data breach", "privacy violation",
];

// Behavioral complaint subs — NO keyword filter, fetched broadly for cluster analysis
// These communities vent before they sue; we detect patterns before litigation starts
const COMPLAINT_CLUSTER_SUBS = [
  // Medical / pharma side effects
  "ChronicPain", "ChronicIllness", "diabetes", "cancer", "ADHD", "depression",
  "Fibromyalgia", "MultipleSclerosis", "lupus", "AskDocs",
  // Consumer products
  "mildlyinfuriating", "BuyItForLife", "amazon", "Frugal", "ProductRecalls",
  // Financial harm
  "personalfinance", "Banking", "CreditCards", "Insurance", "StudentLoans",
  // Auto
  "MechanicAdvice", "cars", "askcarsales", "TeslaMotors", "prius",
  // Food / environment
  "foodsafety", "nutrition", "Cooking", "environment",
  // Tech / privacy
  "privacy", "talesfromtechsupport", "software",
  // Employment
  "WorkReform", "antiwork", "AskHR",
  // Housing
  "renting", "FirstTimeHomeBuyer", "HomeImprovement",
];

// Complaint-behavior web searches — looking for PATTERNS not legal action
const COMPLAINT_WEB_SEARCHES = [
  // Consumer complaint spikes
  "hundreds of complaints users reporting product injury 2026",
  "reddit users reporting same problem product defect 2026",
  "social media users complaining about drug side effects 2026",
  "consumers reporting financial harm company overcharge 2026",
  // Platform-specific complaint searches
  "site:reddit.com complaints injury side effects product 2026",
  "TikTok users complaining product caused injury harm 2026",
  "Twitter users reporting same defect company problem 2026",
  // Review site complaint spikes
  "consumer complaints spike product safety 2026 site:bbb.org OR site:trustpilot.com OR site:consumeraffairs.com",
  // Medical complaint patterns
  "patients reporting adverse effects drug device 2026",
  "doctors reporting unusual side effects medication 2026",
  // Whistleblower / insider complaint patterns
  "employees reporting unsafe product internal company 2026",
  "former employees warning about product safety 2026",
];

const CLAUDE_WEB_SEARCHES = [
  // Plaintiff intel sites
  "new class action lawsuit filed 2026 site:classaction.org OR site:topclassactions.com OR site:aboutlawsuits.com",
  "new MDL consolidation JPML transfer order 2026",
  // Social media complaint signals
  "complaints injury recall product Twitter Reddit 2026",
  "TikTok viral product injury complaint class action 2026",
  "YouTube product recall warning consumers 2026",
  // Mass tort filings
  "pharmaceutical mass tort new filing 2026",
  "medical device MDL new class action 2026",
  // Investigative journalism
  "investigative report corporate fraud consumer harm 2026 site:propublica.org OR site:revealnews.org OR site:icij.org",
  // Regulatory signals
  "state attorney general investigation consumer protection lawsuit 2026",
  "NHTSA investigation opened vehicle defect 2026",
  "FDA warning letter adverse events class action potential 2026",
  // Emerging litigation fronts
  "AI bias discrimination lawsuit class action 2026",
  "cryptocurrency exchange fraud investor lawsuit 2026",
  "data broker stalkerware privacy class action 2026",
  // Whistleblower / inside info
  "whistleblower complaint SEC DOJ FDA corporate misconduct 2026",

  // DOJ/AG criminal enforcement → civil victim pipeline
  "DOJ criminal fraud conviction guilty plea company victims civil lawsuit damages 2026",
  "multistate attorney general enforcement settlement consumer fraud victims compensation 2026",
  "False Claims Act qui tam relator settlement healthcare fraud victim patients 2026",

  // SEC / securities fraud
  "securities fraud stock drop class action complaint filed securities.stanford.edu 2026",
  "company disclosed SEC DOJ subpoena 8-K securities class action investor loss 2026",
  "accounting restatement securities fraud class action investor damages 2026",

  // Plaintiff firm intelligence sites
  "site:millerandzois.com new settlement verdict injury product liability pharmaceutical 2026",
  "site:classaction.com new investigation lawsuit filed consumer drugs automobile 2026",
  "site:classaction.com new investigation tech data breach workers rights environmental 2026",
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function hash(str) {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function yesterday() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SOURCE FETCHERS ─────────────────────────────────────────────────────────

async function fetchRSS(feed) {
  const parser = new Parser({ customFields: { item: ["summary", "description"] } });
  try {
    const res = await fetchWithTimeout(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LegalIntelligenceBot/1.0; +https://mdl-business.vercel.app)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`Status code ${res.status}`);
    const xml = await res.text();
    const parsed = await parser.parseString(xml);
    return (parsed.items || []).slice(0, 20).map(item => ({
      id: hash(item.link || item.title || ""),
      title: item.title || "",
      url: item.link || "",
      description: item.contentSnippet || item.summary || item.description || "",
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: feed.name,
      category: feed.category,
    }));
  } catch (e) {
    console.error(`RSS fetch failed [${feed.name}]:`, e.message);
    return [];
  }
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const parser = new Parser({ timeout: TIMEOUT_MS });
  try {
    const parsed = await parser.parseURL(url);
    return (parsed.items || []).slice(0, 12).map(item => ({
      id: hash(item.link || item.title || ""),
      title: item.title || "",
      url: item.link || "",
      description: item.contentSnippet || "",
      pubDate: item.pubDate || new Date().toISOString(),
      source: `Google News: ${query.slice(0, 50)}`,
      category: "News",
    }));
  } catch (e) {
    console.error(`Google News failed [${query.slice(0, 40)}]:`, e.message);
    return [];
  }
}

async function fetchReddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=50`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "ClassActionIntelBot/1.0" } });
    const data = await res.json();
    const posts = data?.data?.children || [];
    return posts
      .map(p => p.data)
      .filter(p => {
        const text = (p.title + " " + (p.selftext || "")).toLowerCase();
        return REDDIT_KEYWORDS.some(kw => text.includes(kw));
      })
      .slice(0, 8)
      .map(p => ({
        id: hash(p.url || p.id),
        title: p.title,
        url: `https://reddit.com${p.permalink}`,
        description: p.selftext ? p.selftext.slice(0, 400) : "",
        pubDate: new Date(p.created_utc * 1000).toISOString(),
        source: `Reddit r/${subreddit}`,
        category: "Social",
      }));
  } catch (e) {
    console.error(`Reddit failed [r/${subreddit}]:`, e.message);
    return [];
  }
}

// ─── BEHAVIORAL COMPLAINT CLUSTER ANALYSIS ───────────────────────────────────
// Fetches posts from complaint-heavy subreddits with NO keyword filter,
// then batches them to Claude which looks for patterns: multiple people
// complaining about the same product/company/issue. Returns synthesized
// "complaint cluster" leads that represent pre-litigation signals.

const CLUSTER_DETECT_PROMPT = `You are a class action attorney scanning social media for pre-litigation complaint patterns.

Analyze these posts and identify complaint CLUSTERS — situations where multiple people appear to be experiencing the same harm from the same product, company, drug, service, or situation.

Look specifically for:
- Multiple people reporting the same side effect from a drug or medical device
- Multiple people reporting the same product defect causing injury or property damage
- Multiple people reporting the same financial harm from a company (overcharging, fraud, hidden fees)
- Multiple people reporting workplace violations by the same employer or industry
- Multiple people reporting food contamination or illness from the same source
- Multiple people reporting data loss, privacy violation, or security incident from the same company
- Patterns of harm even if no one uses the word "lawsuit" or "lawsuit" — this is pre-litigation signal

Do NOT flag:
- Single complaints with no pattern
- Venting without specific product/company
- Political discussion
- General advice-seeking with no identifiable harm pattern

Return ONLY a JSON array. Each cluster item:
{
  "subject": "<specific product name, drug name, company name, or service — be specific>",
  "complaintType": "injury" | "financial" | "defect" | "side_effects" | "data_privacy" | "employment" | "food_safety" | "environmental",
  "severity": "high" | "medium" | "low",
  "postCount": <number of posts in this cluster>,
  "affectedCount": "<estimated people affected based on post content, e.g. '10-50' or 'unknown'>",
  "summary": "<1-2 sentences: what exactly people are complaining about, what harm>",
  "potentialCaseType": "Medical Device" | "Pharmaceutical" | "Auto Defect" | "Environmental" | "Consumer Fraud" | "Data Breach" | "Securities" | "Food Safety" | "Financial Products" | "Employment" | "Antitrust" | "Other",
  "evidenceStrength": "strong" | "moderate" | "weak"
}

If no meaningful clusters exist, return [].`;

async function detectComplaintClusters(posts, subredditName) {
  if (posts.length === 0) return [];

  const postSummaries = posts.slice(0, 25).map((p, i) =>
    `[${i + 1}] r/${subredditName} — "${p.title}"${p.selftext ? `: ${p.selftext.slice(0, 200)}` : ""}`
  ).join("\n");

  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: CLUSTER_DETECT_PROMPT,
        messages: [{ role: "user", content: `Analyze these posts from r/${subredditName}:\n\n${postSummaries}` }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const clusters = JSON.parse(match[0]);
    return clusters
      .filter(c => c.subject && c.summary && c.severity !== "low")
      .map(c => ({
        id: hash(`cluster|${subredditName}|${c.subject}|${c.complaintType}`),
        title: `Complaint cluster: ${c.subject} — ${c.complaintType.replace("_", " ")} (${c.postCount} posts in r/${subredditName})`,
        url: `https://reddit.com/r/${subredditName}/search?q=${encodeURIComponent(c.subject)}&sort=new`,
        description: `${c.summary} Affected: ${c.affectedCount || "unknown"}. Evidence strength: ${c.evidenceStrength}.`,
        pubDate: new Date().toISOString(),
        source: `Reddit Complaint Cluster — r/${subredditName}`,
        category: "Social",
        clusterData: c,
      }));
  } catch (e) {
    console.error(`Cluster detection failed [r/${subredditName}]:`, e.message);
    return [];
  }
}

async function fetchRedditComplaintClusters() {
  const allClusters = [];

  // Process subreddits in batches of 4 to avoid hammering Reddit
  for (let i = 0; i < COMPLAINT_CLUSTER_SUBS.length; i += 4) {
    const batch = COMPLAINT_CLUSTER_SUBS.slice(i, i + 4);

    // Fetch raw posts from each sub in batch (no keyword filter — we want ALL complaints)
    const batchPosts = await Promise.all(
      batch.map(async sub => {
        try {
          // Fetch new + hot posts for broader coverage
          const [newRes, hotRes] = await Promise.all([
            fetchWithTimeout(`https://www.reddit.com/r/${sub}/new.json?limit=30`, { headers: { "User-Agent": "ClassActionIntelBot/1.0" } }),
            fetchWithTimeout(`https://www.reddit.com/r/${sub}/hot.json?limit=20`, { headers: { "User-Agent": "ClassActionIntelBot/1.0" } }),
          ]);
          const newData = await newRes.json();
          const hotData = await hotRes.json();
          const newPosts = (newData?.data?.children || []).map(p => p.data);
          const hotPosts = (hotData?.data?.children || []).map(p => p.data);
          // Deduplicate by id
          const seen = new Set();
          return [...newPosts, ...hotPosts].filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          });
        } catch {
          return [];
        }
      })
    );

    // Detect complaint clusters in each subreddit
    for (let j = 0; j < batch.length; j++) {
      const posts = batchPosts[j];
      if (posts.length > 0) {
        const clusters = await detectComplaintClusters(posts, batch[j]);
        allClusters.push(...clusters);
      }
      await delay(200); // small delay between cluster detection calls
    }

    await delay(600); // pause between Reddit batches
  }

  console.log(`Complaint cluster analysis: found ${allClusters.length} clusters across ${COMPLAINT_CLUSTER_SUBS.length} subreddits`);
  return allClusters;
}

async function fetchComplaintWebSearches() {
  const results = [];
  for (const q of COMPLAINT_WEB_SEARCHES) {
    try {
      const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 800,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{
            role: "user",
            content: `Search: ${q}\n\nFind complaint patterns — multiple people reporting the same harm. Return JSON array of items found: [{"title":"...","url":"...","description":"...","pubDate":"ISO or today"}]. Only include results showing systemic complaints affecting multiple people.`,
          }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").filter(Boolean).join("") || "[]";
      const match = text.match(/\[[\s\S]*?\]/);
      if (match) {
        const items = JSON.parse(match[0]);
        for (const item of items) {
          results.push({
            id: hash(item.url || item.title || ""),
            title: item.title || "",
            url: item.url || "",
            description: item.description || "",
            pubDate: item.pubDate || new Date().toISOString(),
            source: `Complaint Search: ${q.slice(0, 50)}`,
            category: "Social",
          });
        }
      }
    } catch (e) {
      console.error(`Complaint search failed [${q.slice(0, 40)}]:`, e.message);
    }
    await delay(400);
  }
  return results;
}

async function fetchCourtListener() {
  const url = `https://www.courtlistener.com/api/rest/v3/search/?type=o&q=%22class+certification%22+OR+%22class+action%22+OR+%22MDL%22+OR+%22mass+tort%22&order_by=dateFiled+desc&filed_after=${yesterday()}&stat_Precedential=on&stat_Published=on`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    return (data.results || []).slice(0, 20).map(r => ({
      id: hash(r.id?.toString() || r.caseName || ""),
      title: r.caseName || "Federal Court Opinion",
      url: `https://www.courtlistener.com${r.absolute_url || ""}`,
      description: (r.snippet || "").replace(/<[^>]*>/g, "").slice(0, 400),
      pubDate: r.dateFiled || new Date().toISOString(),
      source: "CourtListener — Courts",
      category: "Judicial",
    }));
  } catch (e) {
    console.error("CourtListener failed:", e.message);
    return [];
  }
}

// PACER new class action filings via CourtListener docket search
async function fetchCourtListenerDockets() {
  const url = `https://www.courtlistener.com/api/rest/v3/dockets/?nature_of_suit=190&filed_after=${yesterday()}&order_by=-date_filed&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    return (data.results || []).slice(0, 15).map(r => ({
      id: hash(r.id?.toString() || r.case_name || ""),
      title: r.case_name || "New Federal Class Action Filing",
      url: `https://www.courtlistener.com${r.absolute_url || ""}`,
      description: `New class action filed in ${r.court || "federal court"}. Nature of suit: ${r.nature_of_suit || "190 — Contract"}`,
      pubDate: r.date_filed || new Date().toISOString(),
      source: "CourtListener — New Filings",
      category: "Judicial",
    }));
  } catch (e) {
    console.error("CourtListener dockets failed:", e.message);
    return [];
  }
}

// SEC EDGAR — recent 8-K filings mentioning lawsuits, recalls, or investigations
async function fetchSecEdgar() {
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22class+action%22+OR+%22product+recall%22+OR+%22government+investigation%22+OR+%22FDA+warning%22&forms=8-K&dateRange=custom&startdt=${yesterday()}&enddt=${new Date().toISOString().slice(0, 10)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const hits = data.hits?.hits || [];
    return hits.slice(0, 15).map(h => ({
      id: hash(h._id || h._source?.file_date || ""),
      title: `SEC 8-K: ${h._source?.entity_name || "Public Company"} — ${h._source?.file_date || ""}`,
      url: `https://www.sec.gov${h._source?.file_path || ""}`,
      description: `${h._source?.entity_name || ""} filed 8-K disclosing material event. Excerpts: ${(h._source?.period_of_report || "")}`,
      pubDate: h._source?.file_date || new Date().toISOString(),
      source: "SEC EDGAR 8-K",
      category: "Federal",
    }));
  } catch (e) {
    console.error("SEC EDGAR failed:", e.message);
    return [];
  }
}

// SEC EDGAR targeted searches — subpoenas, material weakness, restatements, late filers
// Each of these is a high-signal class action trigger that the basic fetchSecEdgar() misses
const SEC_EDGAR_TARGETS = [
  { q: "subpoena",               forms: "8-K",      label: "Subpoena Disclosures" },
  { q: "material weakness",      forms: "10-K",     label: "Material Weakness" },
  { q: "restatement",           forms: "8-K,10-K", label: "Accounting Restatements" },
  { q: "securities class action", forms: "8-K",    label: "Securities Suits in 8-K" },
];

async function fetchSecEdgarTargeted() {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const results = [];

  for (const target of SEC_EDGAR_TARGETS) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + target.q + '"')}&forms=${target.forms}&dateRange=custom&startdt=${sevenDaysAgo}&enddt=${today}`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: { Accept: "application/json", "User-Agent": "ClassActionIntelBot/1.0 (research@example.com)" },
      });
      const data = await res.json();
      const hits = data.hits?.hits || [];
      for (const h of hits.slice(0, 10)) {
        const s = h._source || {};
        const signalNote =
          target.q === "subpoena"         ? "SEC/DOJ subpoena disclosed — securities fraud / investor class action signal" :
          target.q === "material weakness" ? "Material weakness in controls — Sarbanes-Oxley violation, restatement risk" :
          target.q === "restatement"       ? "Prior earnings overstated — Halliburton fraud-on-market presumption available" :
                                             "Securities class action disclosed in filing";
        results.push({
          id: hash(`secedgar_${h._id || s.entity_name + s.file_date + target.q}`),
          title: `SEC ${s.form_type || target.forms}: ${s.entity_name || "Public Company"} — ${target.label}`,
          url: s.file_path ? `https://www.sec.gov${s.file_path}` : `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + target.q + '"')}&forms=${target.forms}`,
          description: `${s.entity_name || "Public company"} filed ${s.form_type || target.forms} on ${s.file_date || "recent date"} disclosing: "${target.q}". ${signalNote}.`,
          pubDate: s.file_date ? new Date(s.file_date).toISOString() : new Date().toISOString(),
          source: `SEC EDGAR: ${target.label}`,
          category: "Federal",
        });
      }
    } catch (e) {
      console.error(`SEC EDGAR targeted [${target.q}]:`, e.message);
    }
    await delay(300);
  }

  console.log(`SEC EDGAR targeted searches: ${results.length} filings`);
  return results;
}

// CourtListener — False Claims Act, RICO, securities fraud new docket filings
// Nature of suit codes: 375=False Claims, 376=Qui Tam, 470=RICO, 850=Securities
async function fetchCourtListenerFraudDockets() {
  const url = `https://www.courtlistener.com/api/rest/v3/dockets/?nature_of_suit=375,376,470,850&filed_after=${yesterday()}&order_by=-date_filed&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const suitLabels = { "375": "False Claims Act", "376": "Qui Tam", "470": "RICO", "850": "Securities/Commodities" };
    return (data.results || []).slice(0, 15).map(r => ({
      id: hash(`fraud_docket_${r.id?.toString() || r.case_name || ""}`),
      title: r.case_name || "New Federal Fraud/RICO/Securities Filing",
      url: `https://www.courtlistener.com${r.absolute_url || ""}`,
      description: `New civil filing in ${r.court || "federal court"}. Type: ${suitLabels[r.nature_of_suit] || r.nature_of_suit || "Fraud/RICO/Securities"} — potential criminal enforcement parallel or securities class action opportunity.`,
      pubDate: r.date_filed || new Date().toISOString(),
      source: "CourtListener — Fraud/RICO/Securities Filings",
      category: "Judicial",
    }));
  } catch (e) {
    console.error("CourtListener fraud dockets failed:", e.message);
    return [];
  }
}

// NHTSA — recent vehicle safety complaints and investigations via API
async function fetchNHTSA() {
  const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=all&model=all&modelYear=all`;
  // NHTSA doesn't have a general "all recent complaints" endpoint without vehicle params
  // Use their investigations endpoint instead
  const invUrl = `https://api.nhtsa.gov/products/vehicle/recalls?issueDate=${yesterday()}..${new Date().toISOString().slice(0, 10)}&results=20`;
  try {
    const res = await fetchWithTimeout(invUrl, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const results = data.results || [];
    return results.slice(0, 15).map(r => ({
      id: hash(r.NHTSACampaignNumber || r.Component || ""),
      title: `NHTSA Recall: ${r.Make || ""} ${r.Model || ""} ${r.ModelYear || ""} — ${r.Component || ""}`,
      url: `https://www.nhtsa.gov/vehicle-safety/recalls#${r.NHTSACampaignNumber || ""}`,
      description: `${r.Consequence || ""} ${r.Remedy || ""}`.slice(0, 400),
      pubDate: r.ReportReceivedDate || new Date().toISOString(),
      source: "NHTSA Recall Database",
      category: "Federal",
    }));
  } catch (e) {
    console.error("NHTSA API failed:", e.message);
    return [];
  }
}

// CFPB Consumer Complaint Database — find complaint clusters by company
async function fetchCFPBComplaints() {
  const url = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?date_received_min=${yesterday()}&sort=created_date_desc&size=100&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const complaints = data.hits?.hits || [];

    // Aggregate by company + product
    const clusters = {};
    for (const c of complaints) {
      const s = c._source || {};
      const key = `${s.company}|${s.product}|${s.issue}`;
      if (!clusters[key]) clusters[key] = { company: s.company, product: s.product, issue: s.issue, count: 0, states: new Set() };
      clusters[key].count++;
      if (s.state) clusters[key].states.add(s.state);
    }

    // Only surface clusters with 3+ complaints (signal of systemic issue)
    return Object.values(clusters)
      .filter(c => c.count >= 3)
      .slice(0, 10)
      .map(c => ({
        id: hash(`cfpb|${c.company}|${c.product}|${c.issue}`),
        title: `CFPB Complaints: ${c.company} — ${c.issue} (${c.count} complaints)`,
        url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(c.company || "")}`,
        description: `${c.count} consumer complaints about ${c.company} regarding "${c.issue}" on product "${c.product}". States affected: ${[...c.states].slice(0, 5).join(", ")}.`,
        pubDate: new Date().toISOString(),
        source: "CFPB Complaint Database",
        category: "Federal",
      }));
  } catch (e) {
    console.error("CFPB complaints failed:", e.message);
    return [];
  }
}

// PubMed — recent studies on adverse effects, injuries, toxicity (litigation signal)
async function fetchPubMed() {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=(adverse+effects+OR+toxicity+OR+product+liability+OR+drug+injury+OR+chemical+contamination+OR+device+failure)+AND+(lawsuit+OR+litigation+OR+recall+OR+settlement+OR+class+action)&retmax=10&sort=date&retmode=json&datetype=pdat&reldate=30`;
  try {
    const searchRes = await fetchWithTimeout(searchUrl);
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const summaryRes = await fetchWithTimeout(summaryUrl);
    const summaryData = await summaryRes.json();
    const uids = summaryData.result?.uids || [];

    return uids.slice(0, 8).map(uid => {
      const article = summaryData.result[uid] || {};
      return {
        id: hash(`pubmed_${uid}`),
        title: `Medical Research: ${article.title || "Adverse Effects Study"}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        description: `${article.source || "Journal"} — Authors: ${(article.authors || []).slice(0, 2).map(a => a.name).join(", ")}. Published: ${article.pubdate || ""}`,
        pubDate: article.pubdate || new Date().toISOString(),
        source: "PubMed Research",
        category: "Medical",
      };
    });
  } catch (e) {
    console.error("PubMed failed:", e.message);
    return [];
  }
}

// YouTube search for product injury / recall videos
async function fetchYouTube() {
  if (!YOUTUBE_API_KEY) return [];
  const queries = [
    "class action lawsuit 2026",
    "product recall injury warning",
    "MDL mass tort new filing",
    "pharmaceutical side effects injury",
  ];
  const results = [];
  for (const q of queries) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&order=date&publishedAfter=${new Date(Date.now() - 86400000).toISOString()}&maxResults=5&key=${YOUTUBE_API_KEY}`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      for (const item of (data.items || [])) {
        results.push({
          id: hash(item.id?.videoId || item.snippet?.title || ""),
          title: item.snippet?.title || "",
          url: `https://youtube.com/watch?v=${item.id?.videoId}`,
          description: item.snippet?.description?.slice(0, 400) || "",
          pubDate: item.snippet?.publishedAt || new Date().toISOString(),
          source: "YouTube",
          category: "Social",
        });
      }
    } catch (e) {
      console.error(`YouTube failed [${q}]:`, e.message);
    }
  }
  return results;
}

// X (Twitter) API v2 — recent search for complaint clusters and lawsuit signals
// Requires TWITTER_BEARER_TOKEN env var. Uses recent search (last 7 days).
// Searches in batches to stay within rate limits (15 req / 15 min on Basic).
const TWITTER_QUERIES = [
  // Class action filings & MDL
  "\"class action\" lawsuit filed -is:retweet lang:en",
  "\"MDL\" OR \"mass tort\" consolidation lawsuit -is:retweet lang:en",
  "\"class action\" certified OR settlement announced -is:retweet lang:en",
  "\"multidistrict litigation\" filed OR pending -is:retweet lang:en",

  // Plaintiff attorney intelligence
  "\"seeking plaintiffs\" OR \"accepting clients\" injury lawsuit -is:retweet lang:en",
  "plaintiff attorney lawsuit investigation \"sign up\" OR \"join\" -is:retweet lang:en",

  // Product liability & recalls
  "product recall injury lawsuit compensation -is:retweet lang:en",
  "\"FDA recall\" OR \"CPSC recall\" injury lawsuit -is:retweet lang:en",
  "\"side effects\" injury \"class action\" OR lawsuit -is:retweet lang:en",
  "\"defective\" product injury lawsuit settlement -is:retweet lang:en",

  // Government enforcement → civil
  "\"DOJ\" OR \"attorney general\" fraud settlement victims compensation -is:retweet lang:en",
  "\"guilty plea\" fraud victims lawsuit compensation -is:retweet lang:en",
  "state \"attorney general\" lawsuit settlement consumers -is:retweet lang:en",
  "\"FTC\" OR \"CFPB\" enforcement action consumers harmed -is:retweet lang:en",

  // Securities & financial
  "\"securities class action\" OR \"securities fraud\" lawsuit filed -is:retweet lang:en",
  "\"SEC subpoena\" OR \"SEC investigation\" stock drop lawsuit -is:retweet lang:en",
  "\"stock drop\" \"class action\" shareholder lawsuit -is:retweet lang:en",

  // Environmental & mass tort
  "\"PFAS\" OR \"forever chemicals\" contamination lawsuit -is:retweet lang:en",
  "\"toxic\" OR \"chemical exposure\" injury lawsuit settlement -is:retweet lang:en",
  "\"water contamination\" OR \"air pollution\" lawsuit residents -is:retweet lang:en",

  // Data breach & privacy
  "\"data breach\" \"class action\" OR lawsuit settlement -is:retweet lang:en",
  "\"privacy violation\" OR \"CCPA\" OR \"BIPA\" class action lawsuit -is:retweet lang:en",

  // Pharma & medical device
  "\"drug recall\" OR \"device recall\" injury \"class action\" -is:retweet lang:en",
  "\"bellwether trial\" OR \"MDL trial\" verdict OR settlement -is:retweet lang:en",
];

async function fetchTwitter() {
  if (!TWITTER_BEARER_TOKEN) return [];
  const results = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  for (const query of TWITTER_QUERIES) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=created_at,public_metrics,text,context_annotations,entities&expansions=author_id&user.fields=name,username,verified,public_metrics`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      });
      const data = await res.json();
      const tweets = data.data || [];
      const users  = Object.fromEntries((data.includes?.users || []).map(u => [u.id, u]));

      for (const tweet of tweets) {
        // Only surface tweets with meaningful engagement (signal vs noise filter)
        const metrics = tweet.public_metrics || {};
        if ((metrics.retweet_count || 0) + (metrics.like_count || 0) < 1) continue;

        const author = users[tweet.author_id] || {};
        results.push({
          id:          hash(`twitter_${tweet.id}`),
          title:       `X/@${author.username || "user"}: ${tweet.text.slice(0, 120)}`,
          url:         `https://x.com/${author.username || "i"}/status/${tweet.id}`,
          description: tweet.text,
          pubDate:     tweet.created_at || new Date().toISOString(),
          source:      `X/Twitter — ${query.slice(0, 40)}`,
          category:    "Social",
        });
      }
    } catch (e) {
      console.error(`Twitter search failed [${query.slice(0, 40)}]:`, e.message);
    }
    await delay(500); // paid tier — higher rate limit
  }
  console.log(`Twitter: ${results.length} tweets found across ${TWITTER_QUERIES.length} queries`);
  return results;
}

// Claude web search — covers social platforms, plaintiff sites, investigative journalism
async function fetchClaudeWebSearch(query) {
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search: ${query}\n\nReturn a JSON array of up to 5 relevant items found. Each: {"title":"...","url":"...","description":"...","pubDate":"ISO date or today"}. Return ONLY the JSON array.`,
        }],
      })
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").filter(Boolean).join("") || "[]";
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const items = JSON.parse(match[0]);
    return items.map(item => ({
      id: hash(item.url || item.title || ""),
      title: item.title || "",
      url: item.url || "",
      description: item.description || "",
      pubDate: item.pubDate || new Date().toISOString(),
      source: `Web: ${query.slice(0, 50)}`,
      category: "Social",
    }));
  } catch (e) {
    console.error(`Web search failed [${query.slice(0, 40)}]:`, e.message);
    return [];
  }
}

// ─── FULL-TEXT EXTRACTION (Jina AI reader) ────────────────────────────────────
// Fetches clean readable text from any URL — strips HTML, handles JS rendering.
// SEC EDGAR 8-K filings, Twitter/X posts, court docket pages are all fetched.
// Only skip Reddit (post text already captured) and raw cloud storage blobs.

// Skip only: Reddit (post text already in item.description), raw binary storage blobs
const SKIP_FULLTEXT = ["reddit.com", "storage.googleapis.com", "storage.courtlistener.com"];

async function fetchArticleText(url) {
  if (!url || SKIP_FULLTEXT.some(s => url.includes(s))) return "";
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text", "X-No-Cache": "true" },
    });
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 3000);
  } catch { return ""; }
}

// ─── TWO-PASS CLAUDE ANALYSIS ─────────────────────────────────────────────────

async function triageWithClaude(item) {
  const prompt = `Lead: ${item.title}\nSource: ${item.source}\nDate: ${item.pubDate}\n${item.description ? `Summary: ${item.description.slice(0, 300)}` : ""}`;
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        system: QUICK_TRIAGE_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    console.error("Triage failed:", e.message);
    return null;
  }
}

async function deepAnalyzeWithClaude(item) {
  const fullText = await fetchArticleText(item.url);
  const content  = fullText
    ? `${item.description}\n\n--- FULL ARTICLE TEXT ---\n${fullText}`
    : item.description;
  const prompt = `Perform a full litigation intelligence analysis on this lead:\n\nTitle: ${item.title}\nSource: ${item.source}\nDate: ${item.pubDate}\nContent: ${content}\nURL: ${item.url}`;
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        system: DEEP_ANALYSIS_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    return JSON.parse(match[0]);
  } catch (e) {
    console.error("Deep analysis failed:", e.message);
    return null;
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const runId = `scan_${Date.now()}`;
  console.log(`[${runId}] Starting comprehensive scan`);

  // ── 1. FETCH ALL SOURCES IN PARALLEL BATCHES ──────────────────────────────

  // Batch 1: Government RSS (all in parallel)
  const govResults = await Promise.all(GOV_RSS_FEEDS.map(fetchRSS)).then(r => r.flat());

  // Batch 2: Google News + Reddit (in parallel)
  const [newsResults, redditResults] = await Promise.all([
    Promise.all(GOOGLE_NEWS_QUERIES.map(q => fetchGoogleNews(q))).then(r => r.flat()),
    Promise.all(REDDIT_SUBS.map(fetchReddit)).then(r => r.flat()),
  ]);

  // Batch 3: Specialized APIs (in parallel)
  const [courtResults, courtDocketResults, courtFraudResults, secResults, secTargetedResults, nhtsaResults, cfpbResults, pubmedResults, ytResults, twitterResults] = await Promise.all([
    fetchCourtListener(),
    fetchCourtListenerDockets(),
    fetchCourtListenerFraudDockets(),
    fetchSecEdgar(),
    fetchSecEdgarTargeted(),
    fetchNHTSA(),
    fetchCFPBComplaints(),
    fetchPubMed(),
    fetchYouTube(),
    fetchTwitter(),
  ]);

  // Batch 4: Legal/news web searches (sequential)
  const webSearchResults = [];
  for (const q of CLAUDE_WEB_SEARCHES) {
    const results = await fetchClaudeWebSearch(q);
    webSearchResults.push(...results);
    await delay(400);
  }

  // Batch 5: Behavioral complaint cluster analysis across complaint-heavy subreddits
  // This runs AFTER other fetches — it's the most AI-intensive batch
  // Each sub is fetched without keyword filter, posts batched to Claude for pattern detection
  console.log(`[${runId}] Starting behavioral complaint cluster analysis (${COMPLAINT_CLUSTER_SUBS.length} subreddits)...`);
  const clusterResults = await fetchRedditComplaintClusters();

  // Batch 6: Complaint-behavior web searches (looking for patterns, not lawsuits)
  const complaintWebResults = await fetchComplaintWebSearches();

  const allItems = [
    ...govResults,
    ...newsResults,
    ...redditResults,
    ...courtResults,
    ...courtDocketResults,
    ...courtFraudResults,
    ...secResults,
    ...secTargetedResults,
    ...nhtsaResults,
    ...cfpbResults,
    ...pubmedResults,
    ...ytResults,
    ...twitterResults,
    ...webSearchResults,
    ...clusterResults,
    ...complaintWebResults,
  ];

  const totalSources = GOV_RSS_FEEDS.length + GOOGLE_NEWS_QUERIES.length + REDDIT_SUBS.length + COMPLAINT_CLUSTER_SUBS.length + COMPLAINT_WEB_SEARCHES.length + 8;
  console.log(`[${runId}] Fetched ${allItems.length} total items (incl. ${clusterResults.length} complaint clusters) from ${totalSources} sources`);

  // ── 2. DEDUPLICATE ────────────────────────────────────────────────────────

  const seenKey = "seen_ids";
  const seenIds = new Set(await kv.smembers(seenKey) || []);
  const SKIP_WORDS = ["expired", "correction", "retraction", "test post", "removed", "[deleted]"];
  const newItems = allItems.filter(item =>
    item.id &&
    !seenIds.has(item.id) &&
    item.title.length > 10 &&
    !SKIP_WORDS.some(w => item.title.toLowerCase().includes(w))
  );

  console.log(`[${runId}] ${newItems.length} new items after dedup`);

  if (newItems.length === 0) {
    return res.status(200).json({ runId, processed: allItems.length, newItems: 0, newLeads: 0 });
  }

  // Mark all seen (30-day expiry) — do this before scoring to prevent duplicates on retry
  await kv.sadd(seenKey, ...newItems.map(i => i.id));
  await kv.expire(seenKey, 30 * 24 * 3600);

  // ── 3. TRIAGE — fast Haiku pass to filter low-signal items ───────────────

  let triaged = 0;
  const passedTriage = [];

  for (const item of newItems) {
    const triage = await triageWithClaude(item);
    triaged++;

    if (triage && triage.score >= TRIAGE_THRESHOLD) {
      passedTriage.push({ ...item, triageScore: triage.score, triageCaseType: triage.caseType });
    }

    // Minimal delay — Haiku is fast and cheap
    await delay(150);
  }

  console.log(`[${runId}] ${passedTriage.length}/${triaged} items passed triage (score >= ${TRIAGE_THRESHOLD})`);

  // ── 4. DEEP ANALYSIS — Sonnet full intelligence report on passing items ───

  let scored = 0;
  const leads = [];

  for (const item of passedTriage) {
    const analysis = await deepAnalyzeWithClaude(item);
    if (!analysis) continue;

    const lead = {
      id: item.id,
      title: item.title,
      url: item.url,
      description: item.description,
      pubDate: item.pubDate,
      source: item.source,
      category: item.category,
      analysis,
      scannedAt: new Date().toISOString(),
    };

    leads.push(lead);
    scored++;

    // Store in KV with 30-day TTL
    await kv.set(`lead:${item.id}`, JSON.stringify(lead), { ex: 30 * 24 * 3600 });
    await kv.zadd("leads_by_score", { score: analysis.score, member: item.id });

    // Rate limit — Sonnet is expensive per call
    await delay(500);
  }

  // ── 5. STORE SCAN METADATA + HISTORICAL TREND DATA ───────────────────────

  const sortedLeads = leads.sort((a, b) => b.analysis.score - a.analysis.score);
  const today = new Date().toISOString().slice(0, 10);
  const TTL_90 = 90 * 24 * 3600;

  // ── 5a. Topic tracking — what subjects/defendants keep appearing ──────────
  const caseTypeCounts = {};
  const sourceCategoryCounts = {};
  const urgencyCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let scoreSum = 0;

  for (const lead of leads) {
    const a = lead.analysis || {};

    // Subject tracking: defendant name > subCategory > caseType
    const subject = (a.defendantProfile?.name && a.defendantProfile.name !== "Unknown")
      ? a.defendantProfile.name
      : (a.subCategory || a.caseType || "Unknown");
    const subjectKey = subject.slice(0, 60);

    // Global topic mention count (all time, sorted set — higher score = more mentions)
    await kv.zadd("topic_mentions", { score: 1, member: subjectKey, incr: true });

    // Daily topic mentions (for velocity: this week vs last week)
    await kv.zadd(`topic_daily:${today}`, { score: 1, member: subjectKey, incr: true });
    await kv.expire(`topic_daily:${today}`, TTL_90);

    // Case type distribution
    const ct = a.caseType || "Other";
    caseTypeCounts[ct] = (caseTypeCounts[ct] || 0) + 1;

    // Source category distribution
    const cat = lead.category || "Other";
    sourceCategoryCounts[cat] = (sourceCategoryCounts[cat] || 0) + 1;

    // Urgency distribution
    const urg = a.timeline?.urgencyLevel || "LOW";
    if (urgencyCounts[urg] !== undefined) urgencyCounts[urg]++;

    scoreSum += a.score || 0;
  }

  // ── 5b. Daily stats snapshot ──────────────────────────────────────────────
  const highCount = leads.filter(l => (l.analysis?.score || 0) >= 75).length;
  const createCount = leads.filter(l => l.analysis?.joinOrCreate === "CREATE").length;
  const avgScore = leads.length > 0 ? Math.round(scoreSum / leads.length) : 0;

  await kv.hset(`daily_stats:${today}`, {
    date: today,
    leads: scored,
    highPriority: highCount,
    create: createCount,
    avgScore,
    processed: allItems.length,
    clusters: clusterResults.length,
    caseTypes: JSON.stringify(caseTypeCounts),
    sourceCategories: JSON.stringify(sourceCategoryCounts),
    urgency: JSON.stringify(urgencyCounts),
  });
  await kv.expire(`daily_stats:${today}`, TTL_90);

  // ── 5c. Append to scan history log (keep last 90 scans) ──────────────────
  const scanEntry = {
    runId,
    timestamp: new Date().toISOString(),
    sourcesQueried: totalSources,
    processed: allItems.length,
    complaintClusters: clusterResults.length,
    newItems: newItems.length,
    passedTriage: passedTriage.length,
    scored,
    highPriority: highCount,
    avgScore,
    topLead: sortedLeads[0]?.analysis?.headline || null,
    topScore: sortedLeads[0]?.analysis?.score || null,
  };
  await kv.lpush("scan_history", JSON.stringify(scanEntry));
  await kv.ltrim("scan_history", 0, 89);

  // ── 5d. last_scan (for LeadsInbox header) ────────────────────────────────
  await kv.set("last_scan", JSON.stringify(scanEntry), { ex: 7 * 24 * 3600 });

  console.log(`[${runId}] Done. ${allItems.length} fetched → ${newItems.length} new → ${passedTriage.length} passed triage → ${scored} deep-analyzed.`);

  return res.status(200).json({
    runId,
    processed: allItems.length,
    newItems: newItems.length,
    passedTriage: passedTriage.length,
    newLeads: scored,
    topLeads: sortedLeads.slice(0, 5).map(l => ({
      headline: l.analysis.headline,
      score: l.analysis.score,
      confidence: l.analysis.confidence,
      urgency: l.analysis.timeline?.urgencyLevel,
      source: l.source,
    })),
  });
}
