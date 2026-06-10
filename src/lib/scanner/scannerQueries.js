// Scanner query catalog — partitioned by mode.
//
// MATCH_MODE — backward-looking, KNOWN-case signals: settlements approved, MDL
//   transfers, claim windows opening/closing, court rulings, plaintiff-firm
//   announcements of real cases. Default for the hourly cron. TCPA / FDCPA /
//   FCRA queries live here as the new flagship.
//
// RESEARCH_MODE — predictive / pre-litigation signals: FDA warning letters,
//   complaint clusters, whistleblower leaks, "company concealed harm." Only
//   consumed by the Research tab (Phase 5); never runs on the hourly cron.
//
// `getQueries(mode)` returns the right bundle. Mode "both" merges and dedupes.

// ── MATCH MODE — already-filed and already-settled signal -------------------
export const MATCH_MODE = {
  googleNews: [
    // ── TCPA / FDCPA / FCRA flagship — claim windows + settlements ─────────
    "TCPA class action settlement final approval 2026",
    "TCPA settlement claim window opens deadline 2026",
    "robocall settlement claim form deadline filing 2026",
    "TCPA defendant added amended complaint filed 2026",
    "FCC robocall enforcement consent decree settlement 2026",
    "FDCPA debt collector settlement class action approved 2026",
    "FCRA credit reporting settlement class action 2026",
    "autodialer prerecorded call class action settlement 2026",
    "Do Not Call DNC Registry violation settlement 2026",
    "ringless voicemail class action settlement 2026",
    "junk fax TCPA settlement class action 2026",

    // ── Already-forming and recently-filed cases ───────────────────────────
    "class action lawsuit filed 2026",
    "MDL mass tort consolidation transfer order 2026",
    "JPML new MDL transfer order 2026",
    "product recall injury lawsuit filed 2026",
    "pharmaceutical drug lawsuit FDA filing 2026",
    "data breach settlement class action approved 2026",
    "auto defect recall NHTSA class action 2026",
    "PFAS toxic contamination lawsuit class action 2026",
    "securities fraud class action complaint filed 2026",
    "EEOC discrimination class action filed 2026",
    "social media addiction mental health lawsuit filed 2026",
    "cryptocurrency fraud investor class action filed 2026",
    "AI artificial intelligence discrimination lawsuit filed 2026",
    "gig worker employee misclassification lawsuit filed 2026",
    "PFAS firefighting foam contamination lawsuit filed 2026",
    "nursing home neglect abuse lawsuit filed 2026",
    "insulin pricing antitrust class action filed 2026",
    "toxic baby food heavy metals lawsuit filed 2026",
    "rideshare sexual assault class action filed 2026",
    "data broker privacy class action filed 2026",
    "product liability wrongful death settlement 2026",

    // ── DOJ → civil pipeline (criminal conviction → civil claim) ───────────
    "DOJ criminal fraud conviction company executives guilty plea victims civil lawsuit 2026",
    "criminal plea agreement corporate fraud consumer patients investors victims compensation 2026",
    "False Claims Act qui tam whistleblower settlement healthcare hospital fraud 2026",

    // ── State AG enforcement actions / settlements (top 4) ─────────────────
    "California attorney general enforcement action settlement corporate fraud 2026",
    "New York attorney general enforcement settlement consumer fraud 2026",
    "Texas attorney general enforcement action settlement consumer 2026",
    "Florida attorney general enforcement settlement consumer fraud 2026",
    "multistate attorney general coalition settlement corporate fraud 2026",

    // ── State AG — top 25 individual states (settlements, enforcement) ─────
    "Illinois attorney general enforcement settlement consumer fraud 2026",
    "Pennsylvania attorney general enforcement settlement consumer fraud 2026",
    "Ohio attorney general enforcement settlement consumer fraud 2026",
    "Michigan attorney general enforcement settlement consumer fraud 2026",
    "Washington state attorney general enforcement settlement consumer fraud 2026",
    "Massachusetts attorney general enforcement settlement consumer fraud 2026",
    "New Jersey attorney general enforcement settlement consumer fraud 2026",
    "Colorado attorney general enforcement settlement consumer fraud 2026",
    "Minnesota attorney general enforcement settlement consumer fraud 2026",
    "Connecticut attorney general enforcement settlement consumer fraud 2026",
    "Maryland attorney general enforcement settlement consumer fraud 2026",
    "Virginia attorney general enforcement settlement consumer fraud 2026",
    "North Carolina attorney general enforcement settlement consumer fraud 2026",
    "Georgia attorney general enforcement settlement consumer fraud 2026",
    "Arizona attorney general enforcement settlement consumer fraud 2026",
    "Wisconsin attorney general enforcement settlement consumer fraud 2026",
    "Oregon attorney general enforcement settlement consumer fraud 2026",
    "Nevada attorney general enforcement settlement consumer fraud 2026",
    "Missouri attorney general enforcement settlement consumer fraud 2026",
    "Indiana attorney general enforcement settlement consumer fraud 2026",
    "Tennessee attorney general enforcement settlement consumer fraud 2026",
    "Louisiana attorney general enforcement settlement consumer fraud 2026",
    "Kentucky attorney general enforcement settlement consumer fraud 2026",
    "South Carolina attorney general enforcement settlement consumer fraud 2026",
    "Alabama attorney general enforcement settlement consumer fraud 2026",

    // ── State AG regional groupings — remaining 21 states ──────────────────
    "Iowa Nebraska Kansas Arkansas Oklahoma state attorney general enforcement settlement 2026",
    "Utah Idaho Montana Wyoming South Dakota North Dakota state attorney general enforcement 2026",
    "New Mexico West Virginia Mississippi Hawaii state attorney general enforcement settlement 2026",
    "Maine New Hampshire Vermont Rhode Island Delaware Alaska state attorney general settlement 2026",

    // ── SEC / securities class action — already-filed ──────────────────────
    "accounting restatement prior earnings reduced securities class action investor loss 2026",
    "material weakness internal controls restatement securities fraud investor lawsuit 2026",
    "company disclosed SEC subpoena investigation 8-K securities class action filed 2026",
    "securities fraud stock drop class action complaint filed site:securities.stanford.edu 2026",
    "NT 10-K late SEC filing restatement securities fraud class action 2026",

    // ── Specific drug / device / case-type queries — active filings ────────
    "GLP-1 semaglutide Ozempic Wegovy tirzepatide gastroparesis paralysis injury class action 2026",
    "GLP-1 weight loss drug stomach paralysis intestinal injury lawsuit 2026",
    "surgical mesh hernia pelvic floor implant injury recall class action 2026",
    "SSRI antidepressant birth defect PPHN infant injury class action 2026",
    "IUD Mirena Paragard contraceptive device injury migration class action 2026",
    "compounding pharmacy contaminated drug infection injury class action 2026",
    "insulin pump continuous glucose monitor CGM defect injury class action 2026",
    "EV electric vehicle battery fire thermal runaway defect class action 2026",
    "BIPA Illinois biometric facial recognition fingerprint class action settlement 2026",
    "website pixel tracker Meta healthcare HIPAA data class action 2026",
    "ransomware healthcare hospital patient data breach class action 2026",
    "AI deepfake voice cloning synthetic identity fraud class action 2026",
    "bank overdraft NSF junk fee unfair practice class action settlement 2026",
    "subscription trap dark pattern unauthorized recurring charge class action 2026",
    "payday lender usurious interest rate consumer class action 2026",
    "student loan servicer misrepresentation wrongful default class action 2026",
    "non-compete no-poach no-hire agreement workers antitrust class action 2026",
    "nursing home understaffing neglect abuse class action settlement 2026",

    // ── Plaintiff-firm intelligence sites — settlements + new filings ──────
    "site:millerandzois.com settlement verdict product liability pharmaceutical 2026",
    "site:classaction.com new investigation lawsuit consumer automobile drugs 2026",
    "site:classaction.com new investigation medical devices tech environmental 2026",
    "site:topclassactions.com TCPA robocall settlement claim 2026",
    "site:classaction.org TCPA FDCPA settlement claim deadline 2026",
    "site:hbsslaw.com new investigation lawsuit class action 2026",
    "site:levinlaw.com new case investigation mass tort 2026",
    "site:motleyrice.com new case investigation lawsuit 2026",
    "site:seegerweiss.com new investigation mass tort class action 2026",
    "site:lieffcabraser.com new class action investigation lawsuit 2026",
    "site:wisnerbaum.com new investigation pharmaceutical mass tort 2026",
    "site:lawsuit-information-center.com class action lawsuit settlement 2026",
    "site:jdsupra.com class action MDL mass tort new filing 2026",
    "site:masstortnews.org new investigation lawsuit mass tort 2026",
  ],

  // Reddit subs that already mention legal action — keyword-filtered
  redditSubs: [
    "legaladvice", "legal", "AskLawyers",
    "personalfinance", "financialindependence", "investing", "Accounting",
    "medicine", "AskDocs", "diabetes", "cancer", "nursing",
    "news", "worldnews", "technology",
    "ConsumerReports", "privacy",
    "WorkReform", "antiwork",
    "environment", "MechanicAdvice",
  ],

  // Already-legal signal keywords for filtering Reddit posts
  redditKeywords: [
    "recall", "lawsuit", "class action", "mdl", "settlement", "injury",
    "fraud", "compensation", "data breach", "privacy violation",
    "attorney", "mass tort", "personal injury", "product liability",
    "negligence", "tcpa", "robocall", "fdcpa", "fcra", "debt collector",
    "filed lawsuit", "filed complaint", "court order", "settlement reached",
  ],

  // Confirm forming / settled cases via Claude web search
  claudeWebSearch: [
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
    "new class action MDL mass tort filed site:law360.com 2026",
    "new class action lawsuit settlement site:reuters.com/legal 2026",
    "new class action MDL complaint filed site:courthousenews.com 2026",
    "new pharmaceutical medical device mass tort filing site:aboutlawsuits.com OR site:drugwatch.com 2026",
    "new investigation lawsuit announced site:hbsslaw.com OR site:levinlaw.com OR site:motleyrice.com 2026",
    "new investigation mass tort announced site:seegerweiss.com OR site:lieffcabraser.com OR site:wisnerbaum.com 2026",
    "new class action MDL announcement site:jdsupra.com OR site:masstortnews.org 2026",
    "MDL bellwether trial date scheduled selected 2026",
    "MDL class action settlement preliminary approval motion filed 2026",
    "class certification order granted MDL mass tort 2026",
    // TCPA-specific class-action site scrapes
    "TCPA settlement final approval fairness hearing site:topclassactions.com 2026",
    "TCPA FDCPA settlement claim deadline site:classaction.org 2026",
    "robocall settlement claim form deadline site:topclassactions.com OR site:classaction.org 2026",
    "TCPA defendant amended complaint motion filed site:law360.com 2026",
  ],

  // Litigation-forming signals on Twitter/X (filed + announced cases)
  twitter: [
    "\"class action\" filed OR forming pharmaceutical device tcpa -is:retweet lang:en",
    "\"MDL\" OR \"mass tort\" new consolidation filing injury -is:retweet lang:en",
    "\"settlement reached\" OR \"final approval\" class action consumers -is:retweet lang:en",
    "\"TCPA\" OR \"robocall\" settlement claim deadline -is:retweet lang:en",
  ],

  newsApi: [
    "class action lawsuit filed",
    "MDL mass tort consolidation",
    "product recall injury lawsuit",
    "data breach class action settlement",
    "NHTSA investigation vehicle defect recall",
    "securities fraud class action investor",
    "environmental contamination lawsuit residents",
    "TCPA robocall settlement class action",
    "FDCPA debt collection settlement",
  ],

  eventRegistry: [
    "class action lawsuit",
    "mass tort litigation MDL",
    "product recall injury consumers",
    "data breach settlement",
    "environmental contamination lawsuit",
    "securities fraud class action",
    "TCPA robocall settlement",
  ],

  // Research-only sources are empty in match mode
  complaintWebSearches: [],
  complaintClusterSubs: [],
  faersWatch: [],
};

// ── RESEARCH MODE — predictive / pre-litigation signal ----------------------
export const RESEARCH_MODE = {
  googleNews: [
    // PREDICTIVE TIER 1: Regulatory investigations (pre-lawsuit)
    "FDA warning letter company product safety 2026",
    "FDA adverse event reports spike drug device 2026",
    "NHTSA investigation opened vehicle defect safety 2026",
    "OSHA investigation workplace injury fatality company 2026",
    "FTC investigation company deceptive practices consumers 2026",
    "CFPB investigation financial company consumers harmed 2026",
    "CDC outbreak investigation product food contamination 2026",
    "EPA enforcement company toxic contamination community 2026",

    // PREDICTIVE TIER 2: Consumer harm clustering before cases file
    "consumers reporting injuries complaints product 2026",
    "patients adverse effects drug device hospitalizations 2026",
    "whistleblower complaint company safety fraud concealed 2026",
    "internal documents reveal company knew harm 2026",
    "cancer cluster residents contamination investigation 2026",
    "product removed shelves safety concern 2026",
    "company under investigation fraud consumers workers 2026",
    "hospital reports increase adverse events drug 2026",

    // PREDICTIVE TIER 3: Corporate misconduct pre-filing
    "company concealed safety data internal documents 2026",
    "executives knew product dangerous memo 2026",
    "price fixing investigation antitrust 2026",
    "data exposed company customers personal information 2026",
    "wage theft unpaid workers investigation 2026",
    "environmental contamination community residents sick 2026",
    "mass complaints product injury viral 2026",
    "whistleblower complaint FDA corporate fraud 2026",
    "internal documents leak corporate harm 2026",

    // State AG investigations (pre-enforcement)
    "California attorney general investigation enforcement action corporate fraud 2026",
    "New York attorney general investigation enforcement consumer fraud lawsuit 2026",
    "Texas attorney general enforcement action consumer fraud 2026",
    "Florida attorney general investigation enforcement fraud consumers 2026",
    "multistate attorney general coalition investigation corporate fraud settlement 2026",
  ],

  redditSubs: [
    // Behavioral complaint subs — broad fetch for cluster analysis
    "ChronicPain", "ChronicIllness", "diabetes", "cancer", "ADHD", "depression",
    "Fibromyalgia", "MultipleSclerosis", "lupus", "AskDocs",
    "mildlyinfuriating", "BuyItForLife", "amazon", "Frugal", "ProductRecalls",
    "personalfinance", "Banking", "CreditCards", "Insurance", "StudentLoans",
    "MechanicAdvice", "cars", "askcarsales", "TeslaMotors", "prius",
    "foodsafety", "nutrition", "Cooking", "environment",
    "privacy", "talesfromtechsupport", "software",
    "WorkReform", "antiwork", "AskHR",
    "renting", "FirstTimeHomeBuyer", "HomeImprovement",
  ],

  // Pre-litigation behavioral signals — people venting before they sue
  redditKeywords: [
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
    "side effects", "adverse reaction", "malfunction", "dangerous", "unsafe",
    "cover up", "whistleblower",
  ],

  claudeWebSearch: [
    // PREDICTIVE: Pre-litigation investigative signals
    "investigative report corporate fraud concealed harm consumers 2026 site:propublica.org OR site:revealnews.org OR site:icij.org",
    "FDA adverse event reports pattern emerging drug device 2026",
    "NHTSA investigation opened new vehicle defect complaint spike 2026",
    "company knew product dangerous internal documents revealed 2026",
    "whistleblower complaint company fraud harm cover up 2026",
    "cancer cluster community investigation contamination source 2026",
    "patients reporting same adverse reaction drug device pattern 2026",
    "employees reporting unsafe working conditions company 2026",

    // PREDICTIVE: Regulatory pre-enforcement signals
    "FDA warning letter company product 2026",
    "state attorney general investigation company consumers opened 2026",
    "OSHA investigation workplace fatality injury company 2026",
    "FTC investigation company deceptive marketing consumers 2026",
    "DOJ investigation corporate fraud healthcare finance 2026",
    "SEC investigation company fraud executives 2026",

    // PREDICTIVE: Emerging harm patterns
    "new study links drug device product harm injury 2026",
    "doctors warning patients drug device risk 2026",
    "surge reports adverse events FDA FAERS drug 2026",
    "social media complaint cluster product injury company 2026",
    "AI bias discrimination employment housing healthcare 2026",
    "cryptocurrency exchange fraud investors harmed 2026",
  ],

  twitter: [
    "\"anyone else\" \"side effects\" OR \"reaction\" OR \"injured\" product -is:retweet lang:en",
    "\"making me sick\" OR \"made me sick\" product company -is:retweet lang:en",
    "\"adverse reaction\" OR \"adverse event\" drug device hospital -is:retweet lang:en",
    "\"FDA warning letter\" OR \"FDA investigation\" company product safety -is:retweet lang:en",
    "\"NHTSA investigation\" OR \"NHTSA probe\" vehicle defect safety -is:retweet lang:en",
    "\"attorney general\" investigation company consumers fraud -is:retweet lang:en",
    "\"whistleblower\" company safety fraud harm cover -is:retweet lang:en",
    "\"covered up\" OR \"concealed\" company harm injury consumers -is:retweet lang:en",
    "\"cancer cluster\" OR \"PFAS\" OR \"forever chemicals\" residents sick contamination -is:retweet lang:en",
    "\"unauthorized charge\" OR \"overcharged\" company consumers complaint -is:retweet lang:en",
  ],

  newsApi: [
    "FDA warning letter pharmaceutical",
    "pharmaceutical drug injury adverse reaction lawsuit",
    "whistleblower corporate fraud consumer harm",
  ],

  eventRegistry: [
    "pharmaceutical drug injury",
    "whistleblower corporate fraud",
  ],

  complaintWebSearches: [
    "hundreds consumers reporting same injury product 2026",
    "surge complaints product side effects adverse reactions 2026",
    "social media users reporting same defect product injury 2026",
    "consumers reporting financial harm unauthorized charges company 2026",
    "site:reddit.com \"anyone else\" injury side effects product 2026",
    "site:reddit.com \"same problem\" defective product company 2026",
    "TikTok viral complaints product causing injury harm users 2026",
    "consumer complaints spike safety 2026 site:bbb.org",
    "consumer complaints spike safety 2026 site:consumeraffairs.com",
    "physicians reporting unusual pattern adverse events drug 2026",
    "FAERS adverse event reports spike drug device FDA 2026",
    "hospital admissions increase drug device reaction pattern 2026",
    "residents reporting illness contamination source 2026",
    "community meeting contamination sick neighbors 2026",
    "former employee warning product safety cover up 2026",
    "internal company documents reveal concealed harm 2026",
    "SEC whistleblower complaint company fraud employees 2026",
  ],

  complaintClusterSubs: [
    "ChronicPain", "ChronicIllness", "diabetes", "cancer", "ADHD", "depression",
    "Fibromyalgia", "MultipleSclerosis", "lupus", "AskDocs",
    "mildlyinfuriating", "BuyItForLife", "amazon", "Frugal", "ProductRecalls",
    "personalfinance", "Banking", "CreditCards", "Insurance", "StudentLoans",
    "MechanicAdvice", "cars", "askcarsales", "TeslaMotors", "prius",
    "foodsafety", "nutrition", "Cooking", "environment",
    "privacy", "talesfromtechsupport", "software",
    "WorkReform", "antiwork", "AskHR",
    "renting", "FirstTimeHomeBuyer", "HomeImprovement",
  ],

  faersWatch: [
    "semaglutide", "tirzepatide", "ozempic", "wegovy", "mounjaro",
    "talcum powder", "paraquat", "roundup", "hair relaxer",
  ],
};

// ── Mode dispatcher ---------------------------------------------------------
function dedup(arr) {
  return [...new Set(arr || [])];
}

function mergeModes(a, b) {
  return {
    googleNews:           dedup([...a.googleNews, ...b.googleNews]),
    redditSubs:           dedup([...a.redditSubs, ...b.redditSubs]),
    redditKeywords:       dedup([...a.redditKeywords, ...b.redditKeywords]),
    claudeWebSearch:      dedup([...a.claudeWebSearch, ...b.claudeWebSearch]),
    twitter:              dedup([...a.twitter, ...b.twitter]),
    newsApi:              dedup([...a.newsApi, ...b.newsApi]),
    eventRegistry:        dedup([...a.eventRegistry, ...b.eventRegistry]),
    complaintWebSearches: dedup([...a.complaintWebSearches, ...b.complaintWebSearches]),
    complaintClusterSubs: dedup([...a.complaintClusterSubs, ...b.complaintClusterSubs]),
    faersWatch:           dedup([...a.faersWatch, ...b.faersWatch]),
  };
}

export function getQueries(mode) {
  if (mode === "research") return RESEARCH_MODE;
  if (mode === "both")     return mergeModes(MATCH_MODE, RESEARCH_MODE);
  return MATCH_MODE; // default
}
