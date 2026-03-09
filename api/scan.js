// Vercel serverless function — triggered daily by cron (vercel.json)
// Also callable manually: GET /api/scan
// Fetches 50+ sources, deduplicates, two-pass Claude analysis, stores in Vercel KV

import Parser from "rss-parser";
import { createHash } from "crypto";
import { kv } from "@vercel/kv";
import { QUICK_TRIAGE_PROMPT, DEEP_ANALYSIS_PROMPT, buildDeepAnalysisPromptWithKB } from "../src/lib/kbRubric.js";
import { KB_CASES } from "../src/data/knowledgeBase.js";

// Build KB-enhanced analysis prompt once at startup (static — 165 cases injected)
const DEEP_ANALYSIS_PROMPT_WITH_KB = buildDeepAnalysisPromptWithKB(KB_CASES);

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const YOUTUBE_API_KEY    = process.env.YOUTUBE_API_KEY;    // optional
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN; // optional — X API v2
const NEWS_API_KEY       = process.env.NEWS_API_KEY;       // optional — newsapi.org
const EVENT_REGISTRY_KEY = process.env.EVENT_REGISTRY_KEY; // optional — eventregistry.org

const TIMEOUT_MS = 12000;
const TRIAGE_THRESHOLD = 40; // only deep-analyze items that score >= this

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
  { name: "Courthouse News",      url: "https://www.courthousenews.com/feed/",                                                                 category: "Judicial" },
  // Plaintiff firm intelligence
  { name: "Miller & Zois Blog",         url: "https://www.millerandzois.com/blog/feed/atom/",                                       category: "Plaintiff Firm" },
  { name: "Mass Tort News",             url: "https://masstortnews.org/feed/",                                                      category: "Plaintiff Firm" },
  { name: "JD Supra — Class Actions",   url: "https://www.jdsupra.com/topics/class-action/rss/",                                    category: "Plaintiff Firm" },
  { name: "Duane Morris CA Defense",    url: "https://blogs.duanemorris.com/classactiondefense/feed/",                              category: "Plaintiff Firm" },
];

const GOOGLE_NEWS_QUERIES = [
  // ── PREDICTIVE TIER 1: Regulatory investigations (pre-lawsuit) ──
  "FDA warning letter company product safety 2026",
  "FDA adverse event reports spike drug device 2026",
  "NHTSA investigation opened vehicle defect safety 2026",
  "OSHA investigation workplace injury fatality company 2026",
  "FTC investigation company deceptive practices consumers 2026",
  "CFPB investigation financial company consumers harmed 2026",
  "CDC outbreak investigation product food contamination 2026",
  "EPA enforcement company toxic contamination community 2026",

  // ── PREDICTIVE TIER 2: Consumer harm clustering before cases file ──
  "consumers reporting injuries complaints product 2026",
  "patients adverse effects drug device hospitalizations 2026",
  "whistleblower complaint company safety fraud concealed 2026",
  "internal documents reveal company knew harm 2026",
  "cancer cluster residents contamination investigation 2026",
  "product removed shelves safety concern 2026",
  "company under investigation fraud consumers workers 2026",
  "hospital reports increase adverse events drug 2026",

  // ── PREDICTIVE TIER 3: Corporate misconduct pre-filing ──
  "company concealed safety data internal documents 2026",
  "executives knew product dangerous memo 2026",
  "price fixing investigation antitrust 2026",
  "data exposed company customers personal information 2026",
  "wage theft unpaid workers investigation 2026",
  "environmental contamination community residents sick 2026",
  "mass complaints product injury viral 2026",
  "whistleblower complaint FDA corporate fraud 2026",
  "internal documents leak corporate harm 2026",

  // ── REACTIVE: Cases already forming ──
  "class action lawsuit filed",
  "MDL mass tort consolidation",
  "product recall injury lawsuit",
  "pharmaceutical drug lawsuit FDA",
  "data breach settlement class action",
  "auto defect recall NHTSA",
  "PFAS toxic contamination lawsuit",
  "securities fraud class action filed",
  "NHTSA investigation safety defect 2026",
  "state attorney general lawsuit consumer protection 2026",
  "DOJ investigation corporate fraud consumer harm 2026",
  "EEOC discrimination class action 2026",
  "social media addiction mental health lawsuit 2026",
  "cryptocurrency fraud investor class action 2026",
  "AI artificial intelligence discrimination lawsuit 2026",
  "gig worker employee misclassification lawsuit 2026",
  "PFAS firefighting foam contamination lawsuit 2026",
  "nursing home neglect abuse lawsuit 2026",
  "insulin pricing antitrust class action 2026",
  "toxic baby food heavy metals lawsuit 2026",
  "rideshare sexual assault class action 2026",
  "data broker privacy class action 2026",
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

  // ── SPECIFIC DRUG / DEVICE / CASE TYPE QUERIES ────────────────────────────
  // GLP-1 / weight loss drugs — massive emerging litigation
  "GLP-1 semaglutide Ozempic Wegovy tirzepatide gastroparesis paralysis injury class action 2026",
  "GLP-1 weight loss drug stomach paralysis intestinal injury lawsuit 2026",
  // Specific device categories
  "surgical mesh hernia pelvic floor implant injury recall class action 2026",
  "SSRI antidepressant birth defect PPHN infant injury class action 2026",
  "IUD Mirena Paragard contraceptive device injury migration class action 2026",
  "compounding pharmacy contaminated drug infection injury class action 2026",
  "insulin pump continuous glucose monitor CGM defect injury class action 2026",
  // Auto / Vehicle specific
  "EV electric vehicle battery fire thermal runaway defect class action 2026",
  // Data privacy / tech specific
  "BIPA Illinois biometric facial recognition fingerprint class action settlement 2026",
  "website pixel tracker Meta healthcare HIPAA data class action 2026",
  "ransomware healthcare hospital patient data breach class action 2026",
  "AI deepfake voice cloning synthetic identity fraud class action 2026",
  // Financial / consumer specific
  "bank overdraft NSF junk fee unfair practice class action settlement 2026",
  "subscription trap dark pattern unauthorized recurring charge class action 2026",
  "payday lender usurious interest rate consumer class action 2026",
  "student loan servicer misrepresentation wrongful default class action 2026",
  // Employment / antitrust specific
  "non-compete no-poach no-hire agreement workers antitrust class action 2026",
  "nursing home understaffing neglect abuse class action settlement 2026",

  // Plaintiff firm intelligence sites — active investigation trackers
  "site:millerandzois.com settlement verdict product liability pharmaceutical 2026",
  "site:classaction.com new investigation lawsuit consumer automobile drugs 2026",
  "site:classaction.com new investigation medical devices tech environmental 2026",

  // Major plaintiff law firm blogs — new case announcements and investigations
  "site:hbsslaw.com new investigation lawsuit class action 2026",
  "site:levinlaw.com new case investigation mass tort 2026",
  "site:motleyrice.com new case investigation lawsuit 2026",
  "site:seegerweiss.com new investigation mass tort class action 2026",
  "site:lieffcabraser.com new class action investigation lawsuit 2026",
  "site:wisnerbaum.com new investigation pharmaceutical mass tort 2026",
  "site:lawsuit-information-center.com class action lawsuit settlement 2026",
  "site:jdsupra.com class action MDL mass tort new filing 2026",
  "site:masstortnews.org new investigation lawsuit mass tort 2026",
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
  // Already-legal signals
  "recall", "lawsuit", "class action", "mdl", "settlement", "injury", "defective",
  "toxic", "fraud", "compensation", "contaminated", "misrepresented", "overcharged",
  "discrimination", "harassment", "adverse reaction", "side effects", "malfunction",
  "dangerous", "unsafe", "cover up", "whistleblower", "attorney", "mass tort",
  "personal injury", "product liability", "negligence", "data breach", "privacy violation",
  // Pre-litigation behavioral signals — people venting before they sue
  "anyone else", "same problem", "same issue", "making me sick", "made me sick",
  "hospital", "emergency room", "ER visit", "doctor said", "diagnosed after",
  "stopped working", "caught fire", "exploded", "leaked", "mold", "contamination",
  "rash", "allergic reaction", "severe reaction", "hospitalized", "permanent damage",
  "unauthorized charge", "billed without", "charged twice", "overcharge", "scam",
  "cancer cluster", "cluster of cases", "multiple people", "neighbors also",
  "investigation opened", "under investigation", "probe", "warning letter",
  "former employee", "insider", "leaked document", "internal memo", "covered up",
  "price gouging", "price fixing", "monopoly", "antitrust",
  "misclassified", "unpaid wages", "wage theft", "denied claim",
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

// Complaint-behavior web searches — predictive pre-litigation signals
const COMPLAINT_WEB_SEARCHES = [
  // Consumer complaint volume spikes (before lawsuits form)
  "hundreds consumers reporting same injury product 2026",
  "surge complaints product side effects adverse reactions 2026",
  "social media users reporting same defect product injury 2026",
  "consumers reporting financial harm unauthorized charges company 2026",
  // Platform complaint cluster searches
  "site:reddit.com \"anyone else\" injury side effects product 2026",
  "site:reddit.com \"same problem\" defective product company 2026",
  "TikTok viral complaints product causing injury harm users 2026",
  // Review site complaint spikes (pre-litigation signal)
  "consumer complaints spike safety 2026 site:bbb.org",
  "consumer complaints spike safety 2026 site:consumeraffairs.com",
  // Medical / clinical complaint patterns
  "physicians reporting unusual pattern adverse events drug 2026",
  "FAERS adverse event reports spike drug device FDA 2026",
  "hospital admissions increase drug device reaction pattern 2026",
  // Environmental pre-litigation
  "residents reporting illness contamination source 2026",
  "community meeting contamination sick neighbors 2026",
  // Whistleblower & insider signals
  "former employee warning product safety cover up 2026",
  "internal company documents reveal concealed harm 2026",
  "SEC whistleblower complaint company fraud employees 2026",
];

const CLAUDE_WEB_SEARCHES = [
  // ── PREDICTIVE: Pre-litigation investigative signals ──
  "investigative report corporate fraud concealed harm consumers 2026 site:propublica.org OR site:revealnews.org OR site:icij.org",
  "FDA adverse event reports pattern emerging drug device 2026",
  "NHTSA investigation opened new vehicle defect complaint spike 2026",
  "company knew product dangerous internal documents revealed 2026",
  "whistleblower complaint company fraud harm cover up 2026",
  "cancer cluster community investigation contamination source 2026",
  "patients reporting same adverse reaction drug device pattern 2026",
  "employees reporting unsafe working conditions company 2026",

  // ── PREDICTIVE: Regulatory pre-enforcement signals ──
  "FDA warning letter company product 2026",
  "state attorney general investigation company consumers opened 2026",
  "OSHA investigation workplace fatality injury company 2026",
  "FTC investigation company deceptive marketing consumers 2026",
  "DOJ investigation corporate fraud healthcare finance 2026",
  "SEC investigation company fraud executives 2026",

  // ── PREDICTIVE: Emerging harm patterns ──
  "new study links drug device product harm injury 2026",
  "doctors warning patients drug device risk 2026",
  "surge reports adverse events FDA FAERS drug 2026",
  "social media complaint cluster product injury company 2026",
  "AI bias discrimination employment housing healthcare 2026",
  "cryptocurrency exchange fraud investors harmed 2026",

  // ── REACTIVE: Confirm forming cases ──
  "new class action lawsuit filed 2026 site:classaction.org OR site:topclassactions.com OR site:aboutlawsuits.com",
  "new MDL consolidation JPML transfer order 2026",
  "pharmaceutical mass tort new filing 2026",
  "medical device MDL new class action 2026",
  "DOJ criminal fraud conviction guilty plea victims civil lawsuit 2026",
  "multistate attorney general settlement consumer fraud victims 2026",
  "False Claims Act qui tam settlement healthcare fraud 2026",
  "securities fraud class action complaint filed 2026",
  "company disclosed SEC subpoena 8-K securities class action 2026",
  "accounting restatement securities fraud class action 2026",
  "site:millerandzois.com new settlement verdict injury product liability 2026",
  "site:classaction.com new investigation lawsuit filed consumer drugs 2026",
  // Legal news wire — high-quality case reporting
  "new class action MDL mass tort filed site:law360.com 2026",
  "new class action lawsuit settlement site:reuters.com/legal 2026",
  "new class action MDL complaint filed site:courthousenews.com 2026",
  "new pharmaceutical medical device mass tort filing site:aboutlawsuits.com OR site:drugwatch.com 2026",
  // Major plaintiff firms — new investigation announcements
  "new investigation lawsuit announced site:hbsslaw.com OR site:levinlaw.com OR site:motleyrice.com 2026",
  "new investigation mass tort announced site:seegerweiss.com OR site:lieffcabraser.com OR site:wisnerbaum.com 2026",
  "new class action MDL announcement site:jdsupra.com OR site:masstortnews.org 2026",
  // MDL lifecycle milestone monitoring
  "MDL bellwether trial date scheduled selected 2026",
  "MDL class action settlement preliminary approval motion filed 2026",
  "class certification order granted MDL mass tort 2026",
];

// ─── FAERS TERMS (FDA adverse event spikes to query) ─────────────────────────
// Dynamic FAERS monitoring — no fixed drug list.
// fetchFAERS() queries the top-reported drugs broadly, then compares
// recent 30-day counts vs prior 30-day baseline to detect spikes.
// Known drugs to always include for context comparison:
const FAERS_WATCH_ALWAYS = [
  "semaglutide", "tirzepatide", "ozempic", "wegovy", "mounjaro",
  "talcum powder", "paraquat", "roundup", "hair relaxer",
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
  // All complaint web searches run in parallel (was sequential with delays)
  const allResults = await Promise.all(COMPLAINT_WEB_SEARCHES.map(async q => {
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
      if (!match) return [];
      return JSON.parse(match[0]).map(item => ({
        id: hash(item.url || item.title || ""),
        title: item.title || "",
        url: item.url || "",
        description: item.description || "",
        pubDate: item.pubDate || new Date().toISOString(),
        source: `Complaint Search: ${q.slice(0, 50)}`,
        category: "Social",
      }));
    } catch (e) {
      console.error(`Complaint search failed [${q.slice(0, 40)}]:`, e.message);
      return [];
    }
  }));
  return allResults.flat();
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

// MDL Progression Monitor — watches for milestone events in active MDL dockets
// Queries CourtListener for recent orders mentioning bellwether trials, settlement approvals,
// class certification, and JPML transfer orders — surfaces case lifecycle changes as leads.
async function fetchMDLProgressions() {
  const milestoneQueries = [
    { q: "bellwether+trial+date+set", label: "Bellwether Trial Set" },
    { q: "preliminary+settlement+approval+class+action", label: "Settlement Approval" },
    { q: "class+certification+granted+order", label: "Class Cert Granted" },
    { q: "MDL+transfer+order+JPML", label: "MDL Transfer" },
    { q: "discovery+cutoff+class+action+MDL", label: "Discovery Milestone" },
  ];
  const results = [];
  for (const { q, label } of milestoneQueries) {
    try {
      const url = `https://www.courtlistener.com/api/rest/v3/search/?type=o&q=${q}&order_by=dateFiled+desc&filed_after=${yesterday()}&stat_Precedential=on`;
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      const data = await res.json();
      for (const r of (data.results || []).slice(0, 5)) {
        results.push({
          id: hash(`mdlprog_${r.id || r.caseName}_${label}`),
          title: `MDL Milestone [${label}]: ${r.caseName || "Federal MDL"}`,
          url: `https://www.courtlistener.com${r.absolute_url || ""}`,
          description: (r.snippet || "").replace(/<[^>]*>/g, "").slice(0, 400),
          pubDate: r.dateFiled || new Date().toISOString(),
          source: "MDL Progression Monitor",
          category: "Judicial",
        });
      }
    } catch (e) {
      console.error(`MDL progression [${label}]:`, e.message);
    }
    await delay(300);
  }
  console.log(`MDL Progressions: ${results.length} milestone events`);
  return results;
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
// Top 12 Twitter queries — highest signal-to-noise for pre-litigation detection
// Run in parallel (not sequential) to stay within function time budget
const TWITTER_QUERIES = [
  // Consumer harm clustering — people venting before they sue
  "\"anyone else\" \"side effects\" OR \"reaction\" OR \"injured\" product -is:retweet lang:en",
  "\"making me sick\" OR \"made me sick\" product company -is:retweet lang:en",
  "\"adverse reaction\" OR \"adverse event\" drug device hospital -is:retweet lang:en",

  // Regulatory signals
  "\"FDA warning letter\" OR \"FDA investigation\" company product safety -is:retweet lang:en",
  "\"NHTSA investigation\" OR \"NHTSA probe\" vehicle defect safety -is:retweet lang:en",
  "\"attorney general\" investigation company consumers fraud -is:retweet lang:en",

  // Corporate misconduct
  "\"whistleblower\" company safety fraud harm cover -is:retweet lang:en",
  "\"covered up\" OR \"concealed\" company harm injury consumers -is:retweet lang:en",

  // Environmental
  "\"cancer cluster\" OR \"PFAS\" OR \"forever chemicals\" residents sick contamination -is:retweet lang:en",

  // Financial fraud
  "\"unauthorized charge\" OR \"overcharged\" company consumers complaint -is:retweet lang:en",

  // Litigation forming
  "\"class action\" filed OR forming OR investigating pharmaceutical device -is:retweet lang:en",
  "\"MDL\" OR \"mass tort\" new consolidation filing injury -is:retweet lang:en",
];

async function fetchTwitter() {
  if (!TWITTER_BEARER_TOKEN) return [];

  // Run all queries in parallel — much faster than sequential with 500ms delays
  const queryResults = await Promise.all(TWITTER_QUERIES.map(async query => {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=25&tweet.fields=created_at,public_metrics,text&expansions=author_id&user.fields=name,username,verified`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      });
      const data = await res.json();
      if (data.errors || data.error || !data.data) return [];
      const tweets = data.data || [];
      const users  = Object.fromEntries((data.includes?.users || []).map(u => [u.id, u]));
      return tweets
        .filter(t => {
          const m = t.public_metrics || {};
          return (m.retweet_count || 0) + (m.like_count || 0) >= 2; // min engagement filter
        })
        .map(tweet => {
          const author = users[tweet.author_id] || {};
          return {
            id:          hash(`twitter_${tweet.id}`),
            title:       `X/@${author.username || "user"}: ${tweet.text.slice(0, 120)}`,
            url:         `https://x.com/${author.username || "i"}/status/${tweet.id}`,
            description: tweet.text,
            pubDate:     tweet.created_at || new Date().toISOString(),
            source:      `X/Twitter — ${query.slice(0, 40)}`,
            category:    "Social",
          };
        });
    } catch (e) {
      console.error(`Twitter search failed [${query.slice(0, 40)}]:`, e.message);
      return [];
    }
  }));

  const results = queryResults.flat();
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

// Sanitize LLM JSON output — fixes unescaped double quotes inside string values
function sanitizeJsonFromLLM(text) {
  // Strategy: walk the JSON char-by-char, tracking string context.
  // Fixes two classes of LLM JSON bugs:
  //   1. Literal control characters (newline, tab, CR) inside strings → escaped sequences
  //   2. Unescaped double-quotes inside string values → \"
  let result = "";
  let inString = false;
  let prevBackslash = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (inString) {
      if (prevBackslash) {
        result += ch;
        prevBackslash = false;
        continue;
      }
      if (ch === "\\") {
        result += ch;
        prevBackslash = true;
        continue;
      }
      if (ch === '"') {
        // Check if this is a legitimate string terminator by looking ahead
        // for a colon, comma, } or ] (ignoring whitespace)
        let j = i + 1;
        while (j < text.length && (text[j] === " " || text[j] === "\n" || text[j] === "\r" || text[j] === "\t")) j++;
        const next = text[j];
        if (next === ":" || next === "," || next === "}" || next === "]") {
          result += ch;
          inString = false;
        } else {
          // Unescaped quote inside string value — escape it
          result += '\\"';
        }
        continue;
      }
      // Escape literal control characters that break JSON parsing
      if (code === 0x0A) { result += "\\n"; continue; }   // literal newline
      if (code === 0x0D) { result += "\\r"; continue; }   // literal carriage return
      if (code === 0x09) { result += "\\t"; continue; }   // literal tab
      if (code < 0x20)  { result += `\\u${code.toString(16).padStart(4, "0")}`; continue; } // other control chars
      result += ch;
    } else {
      result += ch;
      if (ch === '"') inString = true;
    }
  }
  return result;
}

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

// Batch triage: score up to 15 items in a single Haiku call (15x faster than one-by-one)
async function batchTriageWithClaude(items) {
  const itemList = items.map((item, i) =>
    `[${i}] "${(item.title || "").slice(0, 120)}" | Source: ${item.source} | ${(item.description || "").slice(0, 150)}`
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
        max_tokens: 1200,
        system: `You are a class action attorney screening leads for viability. Score each lead 0-100.
Return ONLY a JSON array, one entry per lead, same order as input:
[{"score":<0-100>,"classification":"CREATE"|"INVESTIGATE"|"PASS","caseType":"<Medical Device|Pharmaceutical|Auto Defect|Environmental|Consumer Fraud|Data Breach|Securities|Food Safety|Financial Products|Employment|Antitrust|Government Liability|Other>"}]
Score 75+: Government action + physical injury + large class + clear damages model
Score 50-74: Some signals present but missing key elements
Score <50: No causation, individual issues dominate, no class, bankruptcy risk, or preemption`,
        messages: [{ role: "user", content: `Score these ${items.length} leads:\n\n${itemList}` }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return items.map(() => null);
    return JSON.parse(match[0]);
  } catch (e) {
    console.error("Batch triage failed:", e.message);
    return items.map(() => null);
  }
}

async function deepAnalyzeWithClaude(item) {
  const fullText = await fetchArticleText(item.url);
  const content  = fullText
    ? `${item.description}\n\n--- FULL ARTICLE TEXT ---\n${fullText}`
    : item.description;
  const prompt = `Perform a full litigation intelligence analysis on this lead. OUTPUT ONLY RAW JSON — no markdown, no code blocks, no explanations. Use single quotes (') for any inline quotations inside string values, NEVER double quotes. Keep every string value on a single logical line (no literal newlines inside strings).\n\nTitle: ${item.title}\nSource: ${item.source}\nDate: ${item.pubDate}\nContent: ${content}\nURL: ${item.url}`;
  try {
    // Use a longer timeout for deep analysis — Sonnet with KB system prompt takes 20-40s
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000); // 90s timeout for deep analysis
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: DEEP_ANALYSIS_PROMPT,
          messages: [
            { role: "user", content: prompt },
            { role: "assistant", content: "{" }, // prefill forces raw JSON (no markdown)
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); } catch(pe) {
      console.error("Deep analysis response parse error:", pe.message, "| raw:", rawText.slice(0, 300));
      throw new Error("Response JSON parse failed");
    }
    if (data.error) {
      console.error("Deep analysis API error:", JSON.stringify(data.error));
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    // Prepend "{" (the prefill) since Anthropic returns only the continuation
    const text = "{" + (data.content?.map(b => b.text || "").join("") || "}");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("Deep analysis no JSON — raw:", text.slice(0, 200));
      throw new Error("No JSON in response");
    }
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (parseErr) {
      // Attempt sanitization — fix unescaped quotes inside string values
      try {
        const sanitized = sanitizeJsonFromLLM(match[0]);
        const sanitizedMatch = sanitized.match(/\{[\s\S]*\}/);
        if (sanitizedMatch) parsed = JSON.parse(sanitizedMatch[0]);
      } catch {}
      if (!parsed) {
        console.error("Deep JSON parse failed:", parseErr.message);
        parsed = {
          score: 50, confidence: 30, classification: "INVESTIGATE",
          joinOrCreate: "CREATE", caseType: "Other",
          headline: item.title?.slice(0, 80) || "Analysis parse failed",
          executiveSummary: "Automated analysis parse error — manual review required.",
          _parseError: parseErr.message,
        };
      }
    }
    return parsed;
  } catch (e) {
    console.error("Deep analysis failed:", e.message, "| item:", item?.title?.slice(0, 60));
    return null;
  }
}

// ─── FAERS — FDA Adverse Event Reporting System ───────────────────────────────
// Queries OpenFDA for adverse event reports spiking in the last 30 days.
// High report count on a drug/device is a strong pre-litigation signal.
async function fetchFAERS() {
  const results = [];
  const now = Date.now();
  const fmt = (ts) => new Date(ts).toISOString().slice(0, 10).replace(/-/g, "");

  // Time windows for spike detection
  const recent = { from: fmt(now - 30 * 86400000), to: fmt(now) };
  const baseline = { from: fmt(now - 90 * 86400000), to: fmt(now - 31 * 86400000) };

  try {
    // ── 1. Top 25 drugs by recent report count (last 30 days) ────────────────
    const recentUrl = `https://api.fda.gov/drug/event.json?search=receivedate:[${recent.from}+TO+${recent.to}]&count=patient.drug.medicinalproduct.exact&limit=25`;
    const baselineUrl = `https://api.fda.gov/drug/event.json?search=receivedate:[${baseline.from}+TO+${baseline.to}]&count=patient.drug.medicinalproduct.exact&limit=50`;

    const [recentRes, baselineRes] = await Promise.all([
      fetchWithTimeout(recentUrl, { headers: { Accept: "application/json" } }),
      fetchWithTimeout(baselineUrl, { headers: { Accept: "application/json" } }),
    ]);
    const recentData = await recentRes.json();
    const baselineData = await baselineRes.json();

    const recentDrugs = recentData.results || [];   // [{ term: "OZEMPIC", count: 847 }, ...]
    const baselineDrugs = baselineData.results || [];

    // Build baseline lookup (normalized to 30-day rate — baseline covers 59 days)
    const baselineMap = {};
    for (const d of baselineDrugs) {
      baselineMap[d.term.toUpperCase()] = Math.round(d.count * (30 / 59));
    }

    // ── 2. Always check the watch list in parallel ────────────────────────────
    const watchResults = await Promise.all(FAERS_WATCH_ALWAYS.map(async (term) => {
      try {
        const url = `https://api.fda.gov/drug/event.json?search=receivedate:[${recent.from}+TO+${recent.to}]+AND+patient.drug.medicinalproduct:"${encodeURIComponent(term)}"&count=receivedate&limit=1`;
        const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
        const data = await res.json();
        return { term, count: data?.meta?.results?.total || 0 };
      } catch { return { term, count: 0 }; }
    }));

    // ── 3. Identify spikes: new entrants + high-growth drugs ─────────────────
    const MIN_REPORTS = 15;        // ignore noise (< 15 reports = not meaningful)
    const SPIKE_THRESHOLD = 1.5;   // 50%+ increase over baseline = spike
    const candidates = new Map();  // term → { recent, baseline, pctChange }

    for (const d of recentDrugs) {
      const key = d.term.toUpperCase();
      const rec = d.count;
      const base = baselineMap[key] || 0;
      if (rec < MIN_REPORTS) continue;
      const pct = base === 0 ? 999 : Math.round(((rec - base) / base) * 100);
      if (base === 0 || pct >= Math.round((SPIKE_THRESHOLD - 1) * 100)) {
        candidates.set(d.term, { recent: rec, baseline: base, pctChange: pct });
      }
    }

    // Add watch-list drugs with meaningful count even if not in top-25
    for (const { term, count } of watchResults) {
      if (count >= MIN_REPORTS && !candidates.has(term.toUpperCase())) {
        const key = term.toUpperCase();
        const base = baselineMap[key] || 0;
        const pct = base === 0 ? 999 : Math.round(((count - base) / base) * 100);
        candidates.set(term, { recent: count, baseline: base, pctChange: pct });
      }
    }

    // ── 4. Create leads for top candidates ───────────────────────────────────
    const sorted = [...candidates.entries()]
      .sort((a, b) => b[1].recent - a[1].recent)
      .slice(0, 10); // top 10 signals

    for (const [term, stats] of sorted) {
      const isSurge = stats.pctChange >= 50;
      const isNew = stats.baseline === 0;
      const spikeLabel = isNew ? "NEW — no prior baseline"
        : isSurge ? `+${stats.pctChange}% vs prior 30-day baseline (${stats.baseline} → ${stats.recent} reports)`
        : `${stats.recent} reports (baseline: ~${stats.baseline}/mo)`;

      results.push({
        id: hash(`faers|${term}|${recent.to}`),
        title: `FDA FAERS Spike: "${term}" — ${stats.recent} adverse events in 30 days${isSurge ? ` (+${stats.pctChange}%)` : ""}`,
        url: `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(term)}"&limit=1`,
        description: `OpenFDA FAERS adverse event database: ${spikeLabel}. ${isSurge || isNew ? "Statistically unusual spike — this pattern precedes pharmaceutical class action filings by 6–18 months." : "Ongoing high-volume adverse event reporting — monitor for trend acceleration."} Drug: ${term}. Review for physical injury pattern, causation science viability, and class size.`,
        pubDate: new Date().toISOString(),
        source: `FDA FAERS (OpenFDA API) — dynamic spike detection`,
        category: "Federal",
      });
    }
  } catch (e) {
    console.error("FAERS dynamic monitoring failed:", e.message);
  }

  console.log(`FAERS: ${results.length} adverse event spike signals (dynamic broad monitoring)`);
  return results;
}

// ─── NEWS API FETCHERS ────────────────────────────────────────────────────────

// Targeted litigation-signal queries for NewsAPI (newsapi.org)
const NEWSAPI_QUERIES = [
  "class action lawsuit filed",
  "MDL mass tort consolidation",
  "product recall injury lawsuit",
  "FDA warning letter pharmaceutical",
  "data breach class action settlement",
  "NHTSA investigation vehicle defect recall",
  "securities fraud class action investor",
  "environmental contamination lawsuit residents",
  "pharmaceutical drug injury adverse reaction lawsuit",
  "whistleblower corporate fraud consumer harm",
];

async function fetchNewsAPI() {
  if (!NEWS_API_KEY) return [];
  const from = yesterday();
  const results = await Promise.all(
    NEWSAPI_QUERIES.map(async q => {
      try {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&from=${from}&pageSize=20&apiKey=${NEWS_API_KEY}`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          console.error(`NewsAPI [${q.slice(0, 40)}]: HTTP ${res.status}`);
          return [];
        }
        const data = await res.json();
        return (data.articles || [])
          .filter(a => a.title && a.url && a.title !== "[Removed]")
          .map(a => ({
            id: hash(a.url || a.title || ""),
            title: a.title,
            url: a.url,
            description: a.description || "",
            pubDate: a.publishedAt || new Date().toISOString(),
            source: `NewsAPI: ${a.source?.name || "News"}`,
            category: "News",
          }));
      } catch (e) {
        console.error(`NewsAPI failed [${q.slice(0, 40)}]:`, e.message);
        return [];
      }
    })
  );
  const flat = results.flat();
  console.log(`NewsAPI: ${flat.length} articles across ${NEWSAPI_QUERIES.length} queries`);
  return flat;
}

// Targeted queries for Event Registry (eventregistry.org)
const EVENT_REGISTRY_QUERIES = [
  "class action lawsuit",
  "mass tort litigation MDL",
  "product recall injury consumers",
  "pharmaceutical drug injury",
  "data breach settlement",
  "environmental contamination lawsuit",
  "securities fraud class action",
  "whistleblower corporate fraud",
];

async function fetchEventRegistry() {
  if (!EVENT_REGISTRY_KEY) return [];
  const results = await Promise.all(
    EVENT_REGISTRY_QUERIES.map(async q => {
      try {
        const res = await fetchWithTimeout("https://eventregistry.org/api/v1/article/getArticles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getArticles",
            keyword: q,
            articlesPage: 1,
            articlesCount: 20,
            articlesSortBy: "date",
            articlesSortByAsc: false,
            dataType: ["news"],
            resultType: "articles",
            lang: "eng",
            apiKey: EVENT_REGISTRY_KEY,
          }),
        });
        if (!res.ok) {
          console.error(`EventRegistry [${q.slice(0, 40)}]: HTTP ${res.status}`);
          return [];
        }
        const data = await res.json();
        return (data.articles?.results || [])
          .filter(a => a.title && a.url)
          .map(a => ({
            id: hash(a.url || a.uri || a.title || ""),
            title: a.title,
            url: a.url,
            description: (a.body || a.description || "").slice(0, 400),
            pubDate: a.dateTime || new Date().toISOString(),
            source: `EventRegistry: ${a.source?.title || "News"}`,
            category: "News",
          }));
      } catch (e) {
        console.error(`EventRegistry failed [${q.slice(0, 40)}]:`, e.message);
        return [];
      }
    })
  );
  const flat = results.flat();
  console.log(`EventRegistry: ${flat.length} articles across ${EVENT_REGISTRY_QUERIES.length} queries`);
  return flat;
}

// ─── CONVERGENCE DETECTION ────────────────────────────────────────────────────
// After all sources are fetched, find defendants/companies that appear across
// 2+ independent source categories. Multi-source convergence is the strongest
// pre-litigation signal — it means the same entity is generating signals in
// government data, social media, news, AND legal filings simultaneously.

const CONVERGENCE_EXTRACT_PROMPT = `Extract the single most specific defendant/company/product name from each lead title.
Return ONLY a JSON array: [{"idx":0,"defendant":"Exact Company Name"}, ...]
Rules: Use specific names (e.g. "3M PFAS" not "company"). Skip government agencies (FDA, DOJ, etc.) as defendants. If no identifiable private defendant, use null.`;

async function detectConvergence(items) {
  if (items.length < 4) return [];

  // Batch extract defendant names from all item titles in one Haiku call
  const titleList = items.map((item, idx) => `[${idx}] ${item.title}`).join("\n");
  let extracted = [];
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
        max_tokens: 1500,
        system: CONVERGENCE_EXTRACT_PROMPT,
        messages: [{ role: "user", content: titleList }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    extracted = JSON.parse(match[0]);
  } catch (e) {
    console.error("Convergence extraction failed:", e.message);
    return [];
  }

  // Group by normalized defendant name × source category
  const entityMap = {};
  for (const { idx, defendant } of extracted) {
    if (!defendant || !items[idx]) continue;
    const key = defendant.toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length < 3) continue;
    if (!entityMap[key]) entityMap[key] = { name: defendant, categories: new Set(), sources: [], items: [] };
    const cat = items[idx].category || "Other";
    entityMap[key].categories.add(cat);
    entityMap[key].sources.push(items[idx].source);
    entityMap[key].items.push(items[idx]);
  }

  // Generate convergence alerts for any defendant in 2+ independent source categories
  const convergenceLeads = [];
  for (const entity of Object.values(entityMap)) {
    if (entity.categories.size < 2) continue;
    const cats = [...entity.categories].join(" + ");
    const topSources = [...new Set(entity.sources)].slice(0, 4).join("; ");
    convergenceLeads.push({
      id: hash(`convergence|${entity.name.toLowerCase()}`),
      title: `CONVERGENCE: ${entity.name} — ${entity.categories.size} independent source categories (${cats})`,
      url: entity.items[0]?.url || "",
      description: `Multi-source convergence signal: "${entity.name}" detected across ${entity.categories.size} independent source categories (${cats}). Total signals: ${entity.items.length}. Sources: ${topSources}. When the same defendant generates signals in government data, social media, legal filings, and news simultaneously, a case is likely forming.`,
      pubDate: new Date().toISOString(),
      source: "Convergence Detector",
      category: "Convergence",
      triageScore: 88,
      triageCaseType: "Multi-Source Convergence",
      convergenceData: {
        defendant: entity.name,
        categories: [...entity.categories],
        itemCount: entity.items.length,
        sourceCount: entity.categories.size,
      },
    });
  }

  // Sort by source category count (most converged first), cap at top 8
  convergenceLeads.sort((a, b) => (b.convergenceData?.sourceCount || 0) - (a.convergenceData?.sourceCount || 0));
  console.log(`Convergence detection: ${convergenceLeads.length} multi-source signals across ${Object.keys(entityMap).length} defendants`);
  return convergenceLeads.slice(0, 8);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ?reset=1 — clear the seen_ids/seen_zset so all items are re-processed on the next scan
  if (req.query.reset === "1") {
    await Promise.all([kv.del("seen_ids"), kv.del("seen_zset")]);
    return res.status(200).json({ reset: true, message: "seen_ids + seen_zset cleared — next scan will re-process all items" });
  }

  // ?reseed=1 — repopulate seen_ids from existing leads_by_score so next scan only processes NEW items
  // Use this after a reset to avoid re-processing all existing leads
  if (req.query.reseed === "1") {
    const existingIds = await kv.zrange("leads_by_score", 0, -1) || [];
    if (existingIds.length > 0) {
      // Batch sadd in groups of 100 to stay within client argument limits
      const BATCH = 100;
      for (let i = 0; i < existingIds.length; i += BATCH) {
        await kv.sadd("seen_ids", ...existingIds.slice(i, i + BATCH));
      }
    }
    return res.status(200).json({ reseeded: true, count: existingIds.length, message: `seen_ids populated with ${existingIds.length} existing lead IDs — next scan will only process new items` });
  }

  // ?purge=1 — delete ALL stored leads + seen tracking so the inbox starts fresh
  if (req.query.purge === "1") {
    const ids = await kv.zrange("leads_by_score", 0, -1) || [];
    if (ids.length > 0) {
      const pipeline = kv.pipeline();
      ids.forEach(id => pipeline.del(`lead:${id}`));
      await pipeline.exec();
    }
    await Promise.all([
      kv.del("leads_by_score"),
      kv.del("seen_ids"),
      kv.del("seen_zset"),
      kv.del("opportunities:latest"),
    ]);
    return res.status(200).json({ purged: true, leadsDeleted: ids.length, message: "All leads cleared. Next scan will populate fresh leads." });
  }

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
  const [courtResults, courtDocketResults, courtFraudResults, mdlProgressionResults, secResults, secTargetedResults, nhtsaResults, cfpbResults, pubmedResults, ytResults, twitterResults, newsApiResults, eventRegistryResults] = await Promise.all([
    fetchCourtListener(),
    fetchCourtListenerDockets(),
    fetchCourtListenerFraudDockets(),
    fetchMDLProgressions(),
    fetchSecEdgar(),
    fetchSecEdgarTargeted(),
    fetchNHTSA(),
    fetchCFPBComplaints(),
    fetchPubMed(),
    fetchYouTube(),
    fetchTwitter(),
    fetchNewsAPI(),
    fetchEventRegistry(),
  ]);

  // Batches 4–7: run all remaining source types in parallel
  console.log(`[${runId}] Starting parallel fetch: ${CLAUDE_WEB_SEARCHES.length} Claude web searches + complaint clusters + FAERS...`);
  const [webSearchResults, clusterResults, complaintWebResults, faersResults] = await Promise.all([
    // Batch 4: All Claude web searches in parallel (was sequential — major speedup)
    Promise.all(CLAUDE_WEB_SEARCHES.map(q => fetchClaudeWebSearch(q))).then(r => r.flat()),
    // Batch 5: Reddit complaint cluster analysis
    fetchRedditComplaintClusters(),
    // Batch 6: Complaint-behavior web searches
    fetchComplaintWebSearches(),
    // Batch 7: FAERS — FDA adverse event spikes
    fetchFAERS(),
  ]);

  const allItems = [
    ...govResults,
    ...newsResults,
    ...redditResults,
    ...courtResults,
    ...courtDocketResults,
    ...courtFraudResults,
    ...mdlProgressionResults,
    ...secResults,
    ...secTargetedResults,
    ...nhtsaResults,
    ...cfpbResults,
    ...pubmedResults,
    ...ytResults,
    ...twitterResults,
    ...newsApiResults,
    ...eventRegistryResults,
    ...webSearchResults,
    ...clusterResults,
    ...complaintWebResults,
    ...faersResults,
  ];

  const totalSources = GOV_RSS_FEEDS.length + GOOGLE_NEWS_QUERIES.length + REDDIT_SUBS.length + COMPLAINT_CLUSTER_SUBS.length + COMPLAINT_WEB_SEARCHES.length + FAERS_WATCH_ALWAYS.length + NEWSAPI_QUERIES.length + EVENT_REGISTRY_QUERIES.length + 8;
  console.log(`[${runId}] Fetched ${allItems.length} total items (incl. ${clusterResults.length} complaint clusters) from ${totalSources} sources`);

  // ── 2. DEDUPLICATE + DATE FILTER ─────────────────────────────────────────

  // "seen_zset" is a sorted set (score = unix epoch sec) — lets us prune old entries
  // "seen_ids" was the old plain SET key; still read for backwards compat during transition
  const seenKey = "seen_zset";
  const [newMembers, oldMembers] = await Promise.all([
    kv.zrange(seenKey, 0, -1).catch(() => []),
    kv.smembers("seen_ids").catch(() => []),
  ]);
  const seenIds = new Set([...(newMembers || []), ...(oldMembers || [])]);
  const SKIP_WORDS = ["expired", "correction", "retraction", "test post", "removed", "[deleted]"];
  const DATE_CUTOFF_MS = 90 * 24 * 60 * 60 * 1000; // reject items older than 90 days
  const cutoffDate = Date.now() - DATE_CUTOFF_MS;

  const newItems = allItems.filter(item => {
    if (!item.id) return false;
    if (seenIds.has(item.id)) return false;
    if (item.title.length <= 10) return false;
    if (SKIP_WORDS.some(w => item.title.toLowerCase().includes(w))) return false;
    // Drop stale items — RSS feeds and news can return articles years old
    if (item.pubDate) {
      const age = new Date(item.pubDate).getTime();
      if (!isNaN(age) && age < cutoffDate) return false;
    }
    return true;
  });

  console.log(`[${runId}] ${newItems.length} new items after dedup + 90-day date filter`);

  // Always record that the cron fired, even on empty scans — keeps "last scan" timestamp current
  const emptyScanEntry = {
    runId,
    timestamp: new Date().toISOString(),
    sourcesQueried: totalSources,
    processed: allItems.length,
    newItems: newItems.length,
    passedTriage: 0,
    scored: 0,
    note: "no new items after dedup",
  };
  if (newItems.length === 0) {
    await kv.set("last_scan", JSON.stringify(emptyScanEntry), { ex: 7 * 24 * 3600 });
    await kv.lpush("scan_history", JSON.stringify(emptyScanEntry));
    await kv.ltrim("scan_history", 0, 89);
    return res.status(200).json({ runId, processed: allItems.length, newItems: 0, newLeads: 0 });
  }

  // Mark all seen — use a sorted set with timestamp as score so old entries can be pruned
  // Score = unix epoch seconds; prune anything older than 30 days on each scan
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - 30 * 24 * 3600;
  await kv.zadd(seenKey, ...newItems.flatMap(i => [nowSec, i.id]));
  await kv.zremrangebyscore(seenKey, "-inf", cutoffSec); // prune items older than 30 days
  await kv.expire(seenKey, 35 * 24 * 3600); // safety TTL on the whole key

  // ── 3. TRIAGE — fast Haiku pass to filter low-signal items ───────────────

  const passedTriage = [];

  // Batch triage: 15 items per Haiku call, all batches run in parallel — ~15x faster than one-by-one
  const TRIAGE_BATCH_SIZE = 15;
  const triageBatches = [];
  for (let i = 0; i < newItems.length; i += TRIAGE_BATCH_SIZE) {
    triageBatches.push(newItems.slice(i, i + TRIAGE_BATCH_SIZE));
  }
  const batchResults = await Promise.all(triageBatches.map(batch => batchTriageWithClaude(batch)));
  batchResults.forEach((results, batchIdx) => {
    (results || []).forEach((triage, itemIdx) => {
      const item = triageBatches[batchIdx][itemIdx];
      if (item && triage && triage.score >= TRIAGE_THRESHOLD) {
        passedTriage.push({ ...item, triageScore: triage.score, triageCaseType: triage.caseType });
      }
    });
  });

  console.log(`[${runId}] ${passedTriage.length}/${newItems.length} items passed triage (score >= ${TRIAGE_THRESHOLD})`);

  // ── 3a. RECALL / WARNING AUTO-ELEVATION ────────────────────────────────────
  // Government recalls and safety warnings are ALWAYS high-value plaintiff signals.
  // They bypass triage regardless of score — the government already did the discovery.
  // Items from recall-specific sources OR containing recall keywords get auto-elevated.
  const RECALL_SOURCES = new Set([
    "FDA Recalls", "FDA Safety Alerts", "FDA Drug Safety",
    "CPSC Recalls", "FSIS Food Recalls",
    "NHTSA Recall Database", "HHS News",
  ]);
  const RECALL_TITLE_KEYWORDS = [
    "recall", "warning letter", "safety alert", "market withdrawal",
    "public health advisory", "do not use", "do not eat", "do not drink",
    "undeclared allergen", "contamination", "adverse event", "safety notice",
    "class i", "class ii", "class iii", "enforcement action",
  ];
  const passedTriageIds = new Set(passedTriage.map(i => i.id));
  let recallElevated = 0;
  for (const item of newItems) {
    if (passedTriageIds.has(item.id)) continue; // already passed triage
    const titleLower = (item.title || "").toLowerCase();
    const isRecallSource = RECALL_SOURCES.has(item.source);
    const hasRecallKeyword = RECALL_TITLE_KEYWORDS.some(kw => titleLower.includes(kw));
    if (isRecallSource || hasRecallKeyword) {
      passedTriage.push({
        ...item,
        triageScore: 82,
        triageCaseType: "Government Recall / Safety Warning",
        isRecallElevated: true,
      });
      passedTriageIds.add(item.id);
      recallElevated++;
    }
  }
  if (recallElevated > 0) console.log(`[${runId}] ${recallElevated} recall/warning items auto-elevated (bypassed triage)`);

  // ── 3b. CONVERGENCE DETECTION — find defendants appearing in 2+ source categories ──
  // Runs on ALL new items (not just triage passers) — even low-scoring items can
  // form a high-priority convergence signal when they cluster around one defendant.
  const convergenceAlerts = await detectConvergence(newItems.slice(0, 120));
  // Convergence alerts bypass triage — inject directly into deep analysis queue
  const seenConvergenceIds = new Set(passedTriage.map(i => i.id));
  for (const alert of convergenceAlerts) {
    if (!seenConvergenceIds.has(alert.id)) {
      passedTriage.push(alert);
      seenConvergenceIds.add(alert.id);
    }
  }
  console.log(`[${runId}] ${convergenceAlerts.length} convergence alerts injected → ${passedTriage.length} total for deep analysis`);

  // ── 4. DEEP ANALYSIS — Sonnet full intelligence report on passing items ───
  // Cap at 10 per scan: 4 batches × 3 concurrent Sonnet calls (~50s each) ≈ 200s deep analysis
  // + ~90s data gathering + ~10s triage ≈ 300s total — fits within Vercel Pro limit.
  const MAX_DEEP_ANALYSIS = 10;
  const toAnalyze = passedTriage
    .sort((a, b) => (b.triageScore || 0) - (a.triageScore || 0))
    .slice(0, MAX_DEEP_ANALYSIS);

  let scored = 0;
  const leads = [];

  // Run 3 deep analyses concurrently — each takes ~30s, so 2 chunks = ~60s total
  const ANALYSIS_CONCURRENCY = 3;
  console.log(`[${runId}] Starting deep analysis on ${toAnalyze.length} items (${ANALYSIS_CONCURRENCY} concurrent)...`);
  for (let i = 0; i < toAnalyze.length; i += ANALYSIS_CONCURRENCY) {
    const chunk = toAnalyze.slice(i, i + ANALYSIS_CONCURRENCY);
    await Promise.all(chunk.map(async item => {
      const analysis = await deepAnalyzeWithClaude(item);
      if (!analysis) return;

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

      await kv.set(`lead:${item.id}`, JSON.stringify(lead), { ex: 30 * 24 * 3600 });
      await kv.zadd("leads_by_score", { score: analysis.score, member: item.id });
    }));
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

  // ── Step 6: Invalidate caches (opportunities + leads) ────────────────────
  // Fresh leads were just stored — clear both caches so next requests regenerate.
  try {
    await Promise.all([
      kv.del("opportunities:latest"),
      kv.del("leads_cache_v1"),
    ]);
    console.log(`[${runId}] Caches cleared — opportunities + leads will regenerate on next request`);
  } catch {}

  console.log(`[${runId}] Done. ${allItems.length} fetched → ${newItems.length} new → ${passedTriage.length} passed triage → ${scored} deep-analyzed.`);

  // ── Step 7: Slack alert for high-priority leads ───────────────────────────
  // Posts to Slack when any new lead scores ≥ 70. Requires SLACK_WEBHOOK_URL env var.
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const alertLeads = sortedLeads.filter(l => (l.analysis?.score || 0) >= 70);
  if (SLACK_WEBHOOK_URL && alertLeads.length > 0) {
    try {
      const blocks = [
        {
          type: "header",
          text: { type: "plain_text", text: `${alertLeads.length} High-Priority Lead${alertLeads.length > 1 ? "s" : ""} Detected` },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Scan ${runId} · ${allItems.length} sources · ${passedTriage.length} passed triage` }],
        },
        { type: "divider" },
        ...alertLeads.slice(0, 5).flatMap(l => {
          const a = l.analysis || {};
          const scoreEmoji = a.score >= 85 ? "🔴" : a.score >= 75 ? "🟠" : "🟡";
          return [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${scoreEmoji} *Score ${a.score}* · ${a.classification || ""} · ${a.caseType || ""} · ${a.timeline?.urgencyLevel || ""}\n*${a.headline || l.title}*\n${a.executiveSummary ? a.executiveSummary.slice(0, 200) + "..." : ""}`,
              },
              accessory: l.url ? {
                type: "button",
                text: { type: "plain_text", text: "View Source" },
                url: l.url,
              } : undefined,
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: `Source: *${l.source || "Unknown"}* · Fund: ${a.damagesModel?.totalFundEstimate || "Unknown"} · KB Grade: ${a.kbReplicationGrade || "?"}` },
              ],
            },
            { type: "divider" },
          ];
        }),
      ];

      await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      console.log(`[${runId}] Slack alert sent for ${alertLeads.length} high-priority leads`);
    } catch (e) {
      console.error(`[${runId}] Slack alert failed:`, e.message);
    }
  }

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
