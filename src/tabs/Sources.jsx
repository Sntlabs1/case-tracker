// Sources.jsx — Read-only display of all monitored intelligence sources

const FEDERAL_RSS = [
  { name: "FDA Recalls",         url: "fda.gov/recalls", category: "Federal" },
  { name: "FDA Safety Alerts",   url: "fda.gov/medwatch", category: "Federal" },
  { name: "FDA Drug Safety",     url: "fda.gov/drug-safety-podcast", category: "Federal" },
  { name: "CPSC Recalls",        url: "cpsc.gov/recalls", category: "Federal" },
  { name: "FSIS Food Recalls",   url: "fsis.usda.gov/recalls", category: "Federal" },
  { name: "SEC Litigation",      url: "sec.gov/litigation", category: "Federal" },
  { name: "SEC Enforcement",     url: "sec.gov/enforcement", category: "Federal" },
  { name: "FTC Actions",         url: "ftc.gov", category: "Federal" },
  { name: "DOJ Press Releases",  url: "justice.gov", category: "Federal" },
  { name: "EEOC News",           url: "eeoc.gov", category: "Federal" },
  { name: "DOL News",            url: "dol.gov", category: "Federal" },
  { name: "HHS News",            url: "hhs.gov", category: "Federal" },
  { name: "EPA Enforcement",     url: "epa.gov", category: "Federal" },
  { name: "CFPB",                url: "consumerfinance.gov", category: "Federal" },
  { name: "JPML MDL Orders",     url: "jpml.uscourts.gov", category: "Judicial" },
];

const SPECIAL_APIS = [
  { name: "CourtListener — PACER Dockets",    detail: "NOS 375 (FCA), 376 (Qui Tam), 470 (RICO), 850 (Securities) — new filings daily" },
  { name: "SEC EDGAR Full-Text Search",        detail: "Targeted: subpoena 8-K, material weakness 10-K, accounting restatements, securities class action 8-K" },
  { name: "NHTSA Safety Complaints",           detail: "NHTSA API — auto defect complaints + recall notices" },
  { name: "CFPB Consumer Complaints",          detail: "CFPB API — financial product complaint spikes" },
  { name: "PubMed Medical Literature",         detail: "New adverse event studies + drug safety signals" },
  { name: "YouTube (optional)",                detail: "Injury-related video signals when API key configured" },
  { name: "X / Twitter API v2",               detail: "10 targeted recent-search queries: class actions, MDL, complaint clusters, criminal fraud victims, securities fraud, data breach — 7-day rolling window" },
];

const PLAINTIFF_INTEL_SITES = [
  "classaction.org", "topclassactions.com", "aboutlawsuits.com",
  "securities.stanford.edu", "law360.com", "courthousenews.com",
  "lawyersandsettlements.com", "drugwatch.com",
  "millerandzois.com", "classaction.com",
];

const REDDIT_KEYWORD_SUBS = [
  "legaladvice", "legal", "AskLawyers",
  "personalfinance", "financialindependence", "investing", "Accounting",
  "medicine", "AskDocs", "diabetes", "cancer", "nursing",
  "news", "worldnews", "technology",
  "ConsumerReports", "privacy",
  "WorkReform", "antiwork",
  "environment", "MechanicAdvice",
];

const REDDIT_COMPLAINT_CLUSTER_SUBS = [
  "ChronicPain", "ChronicIllness", "diabetes", "cancer", "ADHD", "depression",
  "Fibromyalgia", "MultipleSclerosis", "lupus", "AskDocs",
  "mildlyinfuriating", "BuyItForLife", "amazon", "Frugal", "ProductRecalls",
  "personalfinance", "Banking", "CreditCards", "Insurance", "StudentLoans",
  "MechanicAdvice", "cars", "askcarsales", "TeslaMotors", "prius",
  "foodsafety", "nutrition", "Cooking", "environment",
  "privacy", "talesfromtechsupport", "software",
  "WorkReform", "antiwork", "AskHR",
  "renting", "FirstTimeHomeBuyer", "HomeImprovement",
];

const GOOGLE_NEWS_TOPICS = [
  "Class action lawsuit filed",
  "MDL mass tort consolidation",
  "Product recall injury lawsuit",
  "Pharmaceutical drug lawsuit FDA",
  "Data breach settlement class action",
  "Auto defect recall NHTSA",
  "PFAS toxic contamination lawsuit",
  "Securities fraud class action filed",
  "NHTSA investigation safety defect",
  "State attorney general enforcement",
  "FDA warning letter recall enforcement",
  "DOJ investigation corporate fraud",
  "EEOC discrimination class action",
  "OSHA workplace injury violation",
  "Social media addiction mental health lawsuit",
  "Cryptocurrency fraud investor class action",
  "AI / artificial intelligence discrimination lawsuit",
  "Gig worker misclassification lawsuit",
  "PFAS firefighting foam contamination",
  "Talcum powder asbestos lawsuit",
  "Nursing home neglect abuse lawsuit",
  "Insulin pricing antitrust class action",
  "Toxic baby food heavy metals lawsuit",
  "Rideshare sexual assault class action",
  "Data broker privacy class action",
  "Mass complaint product injury viral",
  "Whistleblower complaint FDA corporate fraud",
  "Internal documents leak corporate harm",
  "Product liability wrongful death settlement",
  "DOJ criminal fraud conviction → civil lawsuit",
  "Criminal plea agreement corporate fraud victims",
  "False Claims Act qui tam whistleblower settlement",
  "Accounting restatement securities class action",
  "Material weakness restatement securities fraud",
  "SEC subpoena 8-K → securities class action",
  "Securities fraud stock drop complaint (stanford.edu)",
  "NT 10-K late SEC filing securities class action",
];

const STATE_AG_COVERAGE = [
  // Tier 1 — dedicated query
  { state: "California",       abbr: "CA", covered: true  },
  { state: "New York",         abbr: "NY", covered: true  },
  { state: "Texas",            abbr: "TX", covered: true  },
  { state: "Florida",          abbr: "FL", covered: true  },
  { state: "Illinois",         abbr: "IL", covered: true  },
  { state: "Pennsylvania",     abbr: "PA", covered: true  },
  { state: "Ohio",             abbr: "OH", covered: true  },
  { state: "Michigan",         abbr: "MI", covered: true  },
  { state: "Washington",       abbr: "WA", covered: true  },
  { state: "Massachusetts",    abbr: "MA", covered: true  },
  { state: "New Jersey",       abbr: "NJ", covered: true  },
  { state: "Colorado",         abbr: "CO", covered: true  },
  { state: "Minnesota",        abbr: "MN", covered: true  },
  { state: "Connecticut",      abbr: "CT", covered: true  },
  { state: "Maryland",         abbr: "MD", covered: true  },
  { state: "Virginia",         abbr: "VA", covered: true  },
  { state: "North Carolina",   abbr: "NC", covered: true  },
  { state: "Georgia",          abbr: "GA", covered: true  },
  { state: "Arizona",          abbr: "AZ", covered: true  },
  { state: "Wisconsin",        abbr: "WI", covered: true  },
  { state: "Oregon",           abbr: "OR", covered: true  },
  { state: "Nevada",           abbr: "NV", covered: true  },
  { state: "Missouri",         abbr: "MO", covered: true  },
  { state: "Indiana",          abbr: "IN", covered: true  },
  { state: "Tennessee",        abbr: "TN", covered: true  },
  { state: "Louisiana",        abbr: "LA", covered: true  },
  { state: "Kentucky",         abbr: "KY", covered: true  },
  { state: "South Carolina",   abbr: "SC", covered: true  },
  { state: "Alabama",          abbr: "AL", covered: true  },
  // Tier 2 — covered via regional grouping
  { state: "Iowa",             abbr: "IA", covered: true, regional: true },
  { state: "Nebraska",         abbr: "NE", covered: true, regional: true },
  { state: "Kansas",           abbr: "KS", covered: true, regional: true },
  { state: "Arkansas",         abbr: "AR", covered: true, regional: true },
  { state: "Oklahoma",         abbr: "OK", covered: true, regional: true },
  { state: "Utah",             abbr: "UT", covered: true, regional: true },
  { state: "Idaho",            abbr: "ID", covered: true, regional: true },
  { state: "Montana",          abbr: "MT", covered: true, regional: true },
  { state: "Wyoming",          abbr: "WY", covered: true, regional: true },
  { state: "South Dakota",     abbr: "SD", covered: true, regional: true },
  { state: "North Dakota",     abbr: "ND", covered: true, regional: true },
  { state: "New Mexico",       abbr: "NM", covered: true, regional: true },
  { state: "West Virginia",    abbr: "WV", covered: true, regional: true },
  { state: "Mississippi",      abbr: "MS", covered: true, regional: true },
  { state: "Hawaii",           abbr: "HI", covered: true, regional: true },
  { state: "Maine",            abbr: "ME", covered: true, regional: true },
  { state: "New Hampshire",    abbr: "NH", covered: true, regional: true },
  { state: "Vermont",          abbr: "VT", covered: true, regional: true },
  { state: "Rhode Island",     abbr: "RI", covered: true, regional: true },
  { state: "Delaware",         abbr: "DE", covered: true, regional: true },
  { state: "Alaska",           abbr: "AK", covered: true, regional: true },
  // DC (multistate coverage)
  { state: "D.C.",             abbr: "DC", covered: true, regional: true },
];

const CLAUDE_WEB_SEARCHES = [
  "New class action lawsuits (classaction.org, topclassactions.com)",
  "New MDL consolidation JPML transfer orders",
  "Injury / recall complaints on Twitter & Reddit",
  "Viral product injury complaints on TikTok",
  "Product recall warnings on YouTube",
  "Pharmaceutical mass tort new filings",
  "Medical device MDL new class actions",
  "Investigative reporting: corporate fraud (ProPublica, Reveal, ICIJ)",
  "State AG investigation consumer protection lawsuit",
  "NHTSA investigation opened vehicle defect",
  "FDA warning letter adverse events",
  "AI bias discrimination lawsuits",
  "Cryptocurrency exchange fraud investor lawsuits",
  "Data broker privacy class actions",
  "SEC / DOJ whistleblower complaint corporate misconduct",
  "DOJ criminal fraud conviction → civil victim pipeline",
  "Multistate AG enforcement settlement consumer fraud",
  "False Claims Act qui tam settlement healthcare fraud",
  "Securities fraud stock drop class action complaints",
  "Company disclosed SEC/DOJ subpoena 8-K → class action",
  "Accounting restatement → securities fraud class action",
];

const DAILY_FEED_QUERIES = [
  "New class action lawsuits filed (plaintiff intel sites)",
  "New MDL mass tort consolidation JPML order",
  "FDA recall injury class action",
  "SEC enforcement action securities fraud class action",
  "FTC consumer protection enforcement action",
  "NHTSA vehicle defect recall investigation",
  "EPA PFAS environmental contamination lawsuit",
  "Pharmaceutical drug injury FDA warning",
  "Product recall personal injury class action",
  "Data breach settlement class action",
  "Social media addiction youth mental health lawsuit",
  "Mass tort new filing complaint injury",
  "Corporate fraud whistleblower class action",
  "Medical device defect recall lawsuit",
  "DOJ criminal fraud conviction → civil lawsuit",
  "Criminal plea agreement corporate fraud victims",
  "USA v. company criminal charges → civil RICO",
  "State attorney general investigation corporate fraud",
  "Multistate AG settlement consumer protection fraud",
  "False Claims Act qui tam healthcare fraud",
  "Company disclosed SEC subpoena 8-K investor class action",
  "Accounting restatement → securities class action",
  "Material weakness restatement securities fraud",
  "Securities fraud stock drop class action (stanford.edu)",
  "NT 10-K late filing → securities class action",
  "RICO civil lawsuit corporate fraud victims",
  "Healthcare insurance fraud criminal → civil victims",
];

// ─── STAT CALCULATIONS ───────────────────────────────────────────────────────

const totalFederalRSS       = FEDERAL_RSS.length;
const totalReddit           = REDDIT_KEYWORD_SUBS.length + REDDIT_COMPLAINT_CLUSTER_SUBS.length;
const totalGoogleQueries    = GOOGLE_NEWS_TOPICS.length;
const totalStateAGs         = STATE_AG_COVERAGE.filter(s => s.covered).length;
const totalClaudeSearches   = CLAUDE_WEB_SEARCHES.length;
const totalFeedQueries      = DAILY_FEED_QUERIES.length;
const totalSpecialAPIs      = SPECIAL_APIS.length;
const totalPlaintiffSites   = PLAINTIFF_INTEL_SITES.length;

const GRAND_TOTAL = totalFederalRSS + totalReddit + totalGoogleQueries + totalStateAGs +
                    totalClaudeSearches + totalFeedQueries + totalSpecialAPIs + totalPlaintiffSites;

// ─── STYLES ───────────────────────────────────────────────────────────────────

const card = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: "18px 20px",
};

const sectionHeader = (color) => ({
  display: "flex", justifyContent: "space-between", alignItems: "center",
  marginBottom: 14, paddingBottom: 10,
  borderBottom: `1px solid rgba(255,255,255,0.07)`,
});

const tag = (color) => ({
  display: "inline-block", padding: "2px 8px", borderRadius: 4,
  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
  background: color + "22", color, border: `1px solid ${color}44`,
});

const pill = (bg, color) => ({
  display: "inline-block", padding: "1px 7px", borderRadius: 12,
  fontSize: 10, fontWeight: 700, background: bg, color,
});

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function CategoryHeader({ title, count, color, badge }) {
  return (
    <div style={sectionHeader(color)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#e8e8f0" }}>{title}</span>
        {badge && <span style={tag(color)}>{badge}</span>}
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{count}</span>
    </div>
  );
}

function SourceList({ items, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
          <span style={{ color, fontSize: 10, marginTop: 3, flexShrink: 0 }}>&#9679;</span>
          <div>
            <span style={{ fontSize: 12, color: "#d0d0e0" }}>{typeof item === "string" ? item : item.name}</span>
            {item.detail && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.detail}</div>}
            {item.url && <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{item.url}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatGrid({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
      {stats.map((s, i) => (
        <div key={i} style={{ ...card, textAlign: "center", padding: "14px 12px" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function Sources() {
  const directCount   = STATE_AG_COVERAGE.filter(s => s.covered && !s.regional).length;
  const regionalCount = STATE_AG_COVERAGE.filter(s => s.regional).length;

  const stats = [
    { value: GRAND_TOTAL, label: "Total Sources",        color: "#C8442F" },
    { value: 15,          label: "Federal RSS Feeds",    color: "#3b82f6" },
    { value: 50,          label: "States AGs Covered",   color: "#22c55e" },
    { value: totalReddit, label: "Reddit Communities",   color: "#f59e0b" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0 }}>Intelligence Sources</h2>
        <p style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
          {GRAND_TOTAL} active sources across 8 categories — backend cron runs hourly, browser feed scans every 1–4 hours
        </p>
      </div>

      <StatGrid stats={stats} />

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Federal RSS Feeds */}
        <div style={card}>
          <CategoryHeader title="Federal Agency RSS Feeds" count={FEDERAL_RSS.length} color="#3b82f6" badge="Live RSS" />
          <SourceList items={FEDERAL_RSS} color="#3b82f6" />
        </div>

        {/* Special APIs */}
        <div style={card}>
          <CategoryHeader title="Specialized APIs" count={SPECIAL_APIS.length} color="#a78bfa" badge="Structured Data" />
          <SourceList items={SPECIAL_APIS} color="#a78bfa" />
        </div>

        {/* State AGs — full 50-state grid */}
        <div style={{ ...card, gridColumn: "1 / -1" }}>
          <CategoryHeader title="State Attorneys General" count="50 / 50 states" color="#22c55e" badge="All 50 States" />
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <span style={pill("rgba(34,197,94,0.15)", "#22c55e")}>Direct query — {directCount} states</span>
            <span style={pill("rgba(107,114,128,0.15)", "#9ca3af")}>Regional group — {regionalCount} states</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 6 }}>
            {STATE_AG_COVERAGE.map((s) => (
              <div key={s.abbr} style={{
                padding: "6px 10px", borderRadius: 6, fontSize: 11,
                background: s.regional ? "rgba(107,114,128,0.08)" : "rgba(34,197,94,0.08)",
                border: `1px solid ${s.regional ? "rgba(107,114,128,0.2)" : "rgba(34,197,94,0.2)"}`,
                color: s.regional ? "#9ca3af" : "#86efac",
                fontWeight: 600,
              }}>
                <span style={{ fontSize: 13 }}>{s.abbr}</span>
                <div style={{ fontSize: 9, fontWeight: 400, marginTop: 1, color: s.regional ? "#555" : "#4ade80aa" }}>
                  {s.regional ? "regional" : "direct"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reddit — keyword */}
        <div style={card}>
          <CategoryHeader title="Reddit — Keyword Filtered" count={REDDIT_KEYWORD_SUBS.length} color="#f97316" badge="Legal Signal" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>
            Posts filtered for: recall, lawsuit, class action, injury, fraud, settlement, whistleblower, and 20 other keywords
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REDDIT_KEYWORD_SUBS.map(s => (
              <span key={s} style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, background: "rgba(249,115,22,0.1)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.2)" }}>
                r/{s}
              </span>
            ))}
          </div>
        </div>

        {/* Reddit — complaint clusters */}
        <div style={card}>
          <CategoryHeader title="Reddit — Complaint Clusters" count={REDDIT_COMPLAINT_CLUSTER_SUBS.length} color="#f59e0b" badge="Pre-Litigation" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>
            Broad scrape with no keyword filter — Claude detects complaint patterns (multiple people, same product/company) before litigation starts
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REDDIT_COMPLAINT_CLUSTER_SUBS.map(s => (
              <span key={s} style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
                r/{s}
              </span>
            ))}
          </div>
        </div>

        {/* Google News Queries */}
        <div style={card}>
          <CategoryHeader title="Google News Queries" count={GOOGLE_NEWS_TOPICS.length} color="#60a5fa" badge="Backend Cron" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>Runs server-side hourly via Vercel cron — pulls top 12 articles per query</p>
          <SourceList items={GOOGLE_NEWS_TOPICS} color="#60a5fa" />
        </div>

        {/* Claude Web Searches */}
        <div style={card}>
          <CategoryHeader title="Claude Web Searches (Backend)" count={CLAUDE_WEB_SEARCHES.length} color="#c084fc" badge="Claude Haiku" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>Claude web_search tool — searches Google + indexes gov sites without CORS restrictions</p>
          <SourceList items={CLAUDE_WEB_SEARCHES} color="#c084fc" />
        </div>

        {/* Daily Feed Queries */}
        <div style={card}>
          <CategoryHeader title="Daily Feed Queries (Browser)" count={DAILY_FEED_QUERIES.length} color="#34d399" badge="Client-Side" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>Runs entirely in the browser — no server needed. Scans every 15m–4h based on interval setting</p>
          <SourceList items={DAILY_FEED_QUERIES} color="#34d399" />
        </div>

        {/* Plaintiff Intel Sites */}
        <div style={card}>
          <CategoryHeader title="Plaintiff Intelligence Sites" count={PLAINTIFF_INTEL_SITES.length} color="#f87171" badge="High Signal" />
          <p style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>
            Highest-signal sources — lawsuit tracking sites, securities class action databases, investigative outlets
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PLAINTIFF_INTEL_SITES.map(s => (
              <span key={s} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: "rgba(248,113,113,0.1)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.2)" }}>
                {s}
              </span>
            ))}
          </div>
        </div>

      </div>

      {/* Coverage legend */}
      <div style={{ marginTop: 20, padding: "14px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pipeline Architecture</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { title: "Backend Cron (Hourly)", desc: "Vercel serverless: RSS feeds, Google News (40+ queries), Reddit (56 subs + complaint cluster AI), CourtListener, SEC EDGAR, NHTSA, CFPB, PubMed, Claude web searches. Stored in Vercel KV.", color: "#3b82f6" },
            { title: "Browser Feed (Auto)", desc: "DailyFeed tab: 27 Claude web_search queries running client-side. Two-pass analysis: Haiku triage → Sonnet deep analysis for score ≥55. Stored in localStorage.", color: "#22c55e" },
            { title: "50-State AG Coverage", desc: "29 dedicated Google News queries (25 individual states + 4 regional groups) covering all 50 states + multistate coalitions. Criminal enforcement → civil victim pipeline.", color: "#f59e0b" },
          ].map((item, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 6, borderLeft: `3px solid ${item.color}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: item.color, marginBottom: 5 }}>{item.title}</div>
              <div style={{ fontSize: 11, color: "#777", lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
