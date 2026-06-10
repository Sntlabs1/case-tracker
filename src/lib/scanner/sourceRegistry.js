// Canonical registry of probeable data sources.
//
// Used by the source-monitor agent to verify each source is reachable and
// returning data on its expected cadence. Display-only category counts (Reddit
// subs, Google News queries, state AG searches) are NOT in this list — those
// are dynamic queries against shared APIs, not standalone endpoints to probe.
// We probe the underlying API once instead.
//
// Each source entry:
//   id          stable slug (also the KV namespace key)
//   name        human label
//   category    used for grouping in the UI
//   kind        "rss" | "rest" | "html"
//   url         exact URL to probe (HEAD or GET)
//   auth        optional — env var name holding a token, applied per `authStyle`
//   authStyle   "bearer" | "token" | "x-api-key" | "x-app-token" | "query-key"
//   ua          optional User-Agent override (for sites that block default UAs)
//   broken      optional — set true when the URL is known-stale and pending an
//               update; the monitor will surface as "Needs URL fix" instead of "Down"
//   ingestKey   optional KV key prefix for last-success tracking from our pipeline
//                (e.g. "tcpa:ingest:courtlistener" → reads .stats.ranAt)

// Real-browser UA for sources that block the default ToroBot UA (FSIS, HHS,
// NHTSA all 403 unauthenticated bots).
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const SOURCES = [
  // ── Federal regulatory RSS ──────────────────────────────────────────────
  { id: "fda-recalls",        name: "FDA Recalls",          category: "Federal RSS", kind: "rss", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml" },
  { id: "fda-safety-alerts",  name: "FDA Safety Alerts",    category: "Federal RSS", kind: "rss", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml" },
  { id: "fda-drug-safety",    name: "FDA Drug Safety",      category: "Federal RSS", kind: "rss", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drug-safety-podcast/rss.xml" },
  { id: "cpsc-recalls",       name: "CPSC Recalls",         category: "Federal RSS", kind: "rss", url: "https://www.cpsc.gov/Recalls.rss", broken: true },
  { id: "fsis-food-recalls",  name: "FSIS Food Recalls",    category: "Federal RSS", kind: "rss", url: "https://www.fsis.usda.gov/rss/recalls.xml", ua: BROWSER_UA },
  { id: "sec-litigation",     name: "SEC Litigation",       category: "Federal RSS", kind: "rss", url: "https://www.sec.gov/rss/litigation/litreleases.xml", broken: true },
  { id: "sec-enforcement",    name: "SEC Enforcement",      category: "Federal RSS", kind: "rss", url: "https://www.sec.gov/rss/divisions/enforce/administrativeproceedings.xml", broken: true },
  { id: "ftc-actions",        name: "FTC Actions",          category: "Federal RSS", kind: "rss", url: "https://www.ftc.gov/rss.xml", broken: true },
  { id: "doj-press",          name: "DOJ Press Releases",   category: "Federal RSS", kind: "rss", url: "https://www.justice.gov/news/rss" },
  { id: "eeoc-news",          name: "EEOC News",            category: "Federal RSS", kind: "rss", url: "https://www.eeoc.gov/rss/newsroom" },
  { id: "dol-news",           name: "DOL News",             category: "Federal RSS", kind: "rss", url: "https://blog.dol.gov/rss.xml" },
  { id: "hhs-news",           name: "HHS News",             category: "Federal RSS", kind: "rss", url: "https://www.hhs.gov/rss/news.xml", ua: BROWSER_UA },
  { id: "cfpb-newsroom",      name: "CFPB Newsroom",        category: "Federal RSS", kind: "rss", url: "https://www.consumerfinance.gov/about-us/newsroom/feed/" },

  // ── Federal REST APIs ───────────────────────────────────────────────────
  { id: "cfpb-complaints-api", name: "CFPB Complaints API",  category: "Federal API", kind: "rest", url: "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?size=1" },
  { id: "nhtsa-recalls-api",   name: "NHTSA Recalls API",    category: "Federal API", kind: "rest", url: "https://api.nhtsa.gov/products/vehicle/recalls?issueDate=20260101&results=1", ua: BROWSER_UA },
  { id: "fda-faers-api",       name: "FDA FAERS API",        category: "Federal API", kind: "rest", url: "https://api.fda.gov/drug/event.json?limit=1" },
  { id: "sec-edgar-search",    name: "SEC EDGAR Search",     category: "Federal API", kind: "rest", url: "https://efts.sec.gov/LATEST/search-index?q=%22class+action%22&forms=8-K" },
  // FCC's Socrata API works without a token at lower rate. Token is optional.
  { id: "fcc-complaints",      name: "FCC Consumer Complaints", category: "Federal API", kind: "rest", url: "https://opendata.fcc.gov/resource/sr6c-syda.json?$limit=1", ingestKey: "tcpa:ingest:fcc" },
  { id: "pubmed-search",       name: "PubMed E-Utils",       category: "Federal API", kind: "rest", url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=lawsuit&retmax=1" },

  // ── Courts ──────────────────────────────────────────────────────────────
  { id: "jpml-mdl",           name: "JPML MDL Orders",      category: "Judicial", kind: "rss", url: "https://ecf.jpml.uscourts.gov/cgi-bin/rss_outside.pl" },
  { id: "courthouse-news",    name: "Courthouse News",      category: "Judicial", kind: "rss", url: "https://www.courthousenews.com/feed/" },
  { id: "courtlistener-search", name: "CourtListener Search API", category: "Judicial", kind: "rest", url: "https://www.courtlistener.com/api/rest/v4/search/?type=r&q=test&page_size=1", auth: "COURTLISTENER_API_TOKEN", authStyle: "token", ingestKey: "tcpa:ingest:courtlistener" },

  // ── Plaintiff firm intelligence ─────────────────────────────────────────
  { id: "miller-zois",        name: "Miller & Zois Blog",   category: "Plaintiff Firm", kind: "rss", url: "https://www.millerandzois.com/blog/feed/atom/" },
  { id: "mass-tort-news",     name: "Mass Tort News",       category: "Plaintiff Firm", kind: "rss", url: "https://masstortnews.org/feed/" },
  { id: "jd-supra-class",     name: "JD Supra Class Actions", category: "Plaintiff Firm", kind: "rss", url: "https://www.jdsupra.com/topics/class-action/rss/" },
  { id: "duane-morris-ca",    name: "Duane Morris CA Defense", category: "Plaintiff Firm", kind: "rss", url: "https://blogs.duanemorris.com/classactiondefense/feed/" },
  { id: "tcpa-world",         name: "TCPAWorld.com",        category: "Plaintiff Firm", kind: "rss", url: "https://tcpaworld.com/feed/", ingestKey: "tcpa:ingest:tcpaworld" },

  // ── News aggregators ────────────────────────────────────────────────────
  { id: "newsapi",            name: "NewsAPI.org",          category: "News API", kind: "rest", url: "https://newsapi.org/v2/everything?q=test&pageSize=1", auth: "NEWS_API_KEY", authStyle: "x-api-key" },
  { id: "event-registry",     name: "EventRegistry",        category: "News API", kind: "rest", url: "https://eventregistry.org/api/v1/article/getArticles?articlesCount=1", auth: "EVENT_REGISTRY_API_KEY", authStyle: "query-key" },
  { id: "google-news-rss",    name: "Google News RSS",      category: "News API", kind: "rss", url: "https://news.google.com/rss/search?q=class+action&hl=en-US&gl=US" },

  // ── Settlement / class-action sites (via Google News fallback) ──────────
  { id: "classaction-org",    name: "ClassAction.org (Google News)", category: "Class Action", kind: "rss", url: "https://news.google.com/rss/search?q=site%3Aclassaction.org+TCPA+settlement&hl=en-US&gl=US", ingestKey: "tcpa:ingest:classaction" },
  { id: "topclassactions",    name: "TopClassActions (Google News)", category: "Class Action", kind: "rss", url: "https://news.google.com/rss/search?q=site%3Atopclassactions.com+TCPA+settlement&hl=en-US&gl=US" },

  // ── Social ──────────────────────────────────────────────────────────────
  { id: "reddit-legal",       name: "Reddit r/legal",       category: "Social", kind: "rest", url: "https://www.reddit.com/r/legal/new.json?limit=1", ua: "Mozilla/5.0 ToroBot/1.0" },
  { id: "reddit-legaladvice", name: "Reddit r/legaladvice", category: "Social", kind: "rest", url: "https://www.reddit.com/r/legaladvice/new.json?limit=1", ua: "Mozilla/5.0 ToroBot/1.0" },
  { id: "twitter-search",     name: "Twitter API",          category: "Social", kind: "rest", url: "https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10", auth: "TWITTER_BEARER_TOKEN", authStyle: "bearer" },
  { id: "youtube-search",     name: "YouTube Data API",     category: "Social", kind: "rest", url: "https://www.googleapis.com/youtube/v3/search?q=test&part=id&maxResults=1", auth: "YOUTUBE_API_KEY", authStyle: "query-key" },

  // ── State aggregators (paid) ────────────────────────────────────────────
  { id: "unicourt",           name: "UniCourt API",         category: "State Aggregator", kind: "rest", url: "https://app.unicourt.com/api/v1/cases?page_size=1", auth: "UNICOURT_API_KEY", authStyle: "bearer", ingestKey: "tcpa:ingest:unicourt" },
  { id: "trellis",            name: "Trellis.law API",      category: "State Aggregator", kind: "rest", url: "https://api.trellis.law/v1/cases?limit=1", auth: "TRELLIS_API_KEY", authStyle: "bearer", ingestKey: "tcpa:ingest:trellis" },
];

export function getSource(id) {
  return SOURCES.find((s) => s.id === id);
}

export function categorize() {
  const map = {};
  for (const s of SOURCES) {
    if (!map[s.category]) map[s.category] = [];
    map[s.category].push(s);
  }
  return map;
}
