import { useState } from "react";

const SOURCES = [
  { id: "fda-recalls", name: "FDA Recalls", category: "Federal", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts", type: "Product Safety" },
  { id: "cpsc", name: "CPSC Recalls", category: "Federal", url: "https://www.cpsc.gov/Recalls", type: "Consumer Products" },
  { id: "nhtsa", name: "NHTSA Recalls", category: "Federal", url: "https://www.nhtsa.gov/recalls", type: "Auto/Vehicle" },
  { id: "fsis", name: "FSIS Recalls", category: "Federal", url: "https://www.fsis.usda.gov/recalls", type: "Food Safety" },
  { id: "fda-major", name: "FDA Major Recalls", category: "Federal", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/major-product-recalls", type: "Major Recalls" },
  { id: "fda-maude", name: "FDA MAUDE (Devices)", category: "Medical", url: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm", type: "Medical Devices" },
  { id: "fda-faers", name: "FDA FAERS (Drugs)", category: "Medical", url: "https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers/fda-adverse-event-reporting-system-faers-public-dashboard", type: "Pharmaceuticals" },
  { id: "vaers", name: "CDC VAERS", category: "Medical", url: "https://vaers.hhs.gov", type: "Vaccines" },
  { id: "clinicaltrials", name: "ClinicalTrials.gov", category: "Medical", url: "https://clinicaltrials.gov", type: "Clinical Trials" },
  { id: "epa", name: "EPA Enforcement", category: "Federal", url: "https://www.epa.gov/enforcement", type: "Environmental" },
  { id: "sec", name: "SEC Litigation", category: "Federal", url: "https://www.sec.gov/litigation", type: "Securities" },
  { id: "cfpb", name: "CFPB Complaints", category: "Federal", url: "https://www.consumerfinance.gov/data-research/consumer-complaints/", type: "Financial Products" },
  { id: "ftc", name: "FTC Cases", category: "Federal", url: "https://www.ftc.gov/legal-library/browse/cases-proceedings", type: "Deceptive Practices" },
  { id: "jpml", name: "JPML MDL Panel", category: "Judicial", url: "https://www.jpml.uscourts.gov", type: "MDL Tracking" },
  { id: "stanford-scac", name: "Stanford Securities CA", category: "Judicial", url: "https://securities.stanford.edu", type: "Securities Class Actions" },
  { id: "foxbiz", name: "Fox Business Recalls", category: "News", url: "https://www.foxbusiness.com/category/product-recalls", type: "News Aggregator" },
  { id: "prnewswire", name: "PR Newswire Recalls", category: "News", url: "https://www.prnewswire.com/news-releases/consumer-products-retail-latest-news/product-recalls-list/", type: "Press Releases" },
  { id: "classaction", name: "ClassAction.org", category: "Plaintiff Intel", url: "https://www.classaction.org", type: "Active Cases" },
  { id: "topclass", name: "TopClassActions.com", category: "Plaintiff Intel", url: "https://topclassactions.com", type: "Settlements & Cases" },
  { id: "aboutlawsuits", name: "AboutLawsuits.com", category: "Plaintiff Intel", url: "https://www.aboutlawsuits.com", type: "Case Tracking" },
  { id: "ny-dos", name: "NY DOS Recalls", category: "State", url: "https://dos.ny.gov/recall-alerts", type: "State Alerts" },
  { id: "ca-oag", name: "CA Attorney General", category: "State", url: "https://oag.ca.gov/consumers", type: "State Enforcement" },
  { id: "bbb", name: "BBB Complaints", category: "Consumer", url: "https://www.bbb.org", type: "Consumer Complaints" },
];

const CASE_TYPES = ["Product Liability","Medical Device","Pharmaceutical","Securities Fraud","Environmental/Toxic Tort","Consumer Protection","Data Breach/Privacy","Auto Defect","Food Safety","Financial Products","Employment","Antitrust"];
const PRIORITIES = ["Critical","High","Medium","Low"];
const STATUSES = ["New Lead","Investigating","Case Filed","MDL Pending","MDL Active","Settled","Closed"];
const PRIORITY_COLORS = { Critical: "#ef4444", High: "#f97316", Medium: "#eab308", Low: "#6b7280" };
const STATUS_COLORS = { "New Lead":"#3b82f6","Investigating":"#8b5cf6","Case Filed":"#f59e0b","MDL Pending":"#ec4899","MDL Active":"#ef4444","Settled":"#22c55e","Closed":"#6b7280" };

const initCases = [
  { id: 1, title: "Philips CPAP Device Recall", source: "FDA Recalls", caseType: "Medical Device", priority: "Critical", status: "MDL Active", affectedPop: "15,000,000+", company: "Philips Respironics", description: "Degraded sound abatement foam in CPAP devices potentially releasing toxic particles and gases.", dateAdded: "2024-06-15", score: 95, notes: "MDL 3014 in W.D. Pa. Massive affected population. Bellwether trials underway.", jurisdiction: "W.D. Pennsylvania" },
  { id: 2, title: "Camp Lejeune Water Contamination", source: "EPA Enforcement", caseType: "Environmental/Toxic Tort", priority: "Critical", status: "MDL Active", affectedPop: "1,000,000+", company: "U.S. Government", description: "Toxic water contamination at Marine Corps Base Camp Lejeune from 1953-1987.", dateAdded: "2024-03-20", score: 92, notes: "PACT Act opened federal claims. E.D.N.C. MDL. High volume litigation.", jurisdiction: "E.D. North Carolina" },
  { id: 3, title: "AFFF Firefighting Foam PFAS", source: "EPA Enforcement", caseType: "Environmental/Toxic Tort", priority: "Critical", status: "MDL Active", affectedPop: "Unknown - Millions", company: "3M, DuPont, others", description: "PFAS 'forever chemicals' in firefighting foam contaminating water supplies nationwide.", dateAdded: "2024-01-10", score: 90, notes: "MDL 2873 in D.S.C. 3M settled for $10.3B with public water systems. Individual claims ongoing.", jurisdiction: "D. South Carolina" },
  { id: 4, title: "Tylenol Autism/ADHD Litigation", source: "FDA FAERS", caseType: "Pharmaceutical", priority: "High", status: "MDL Active", affectedPop: "Millions of users", company: "Johnson & Johnson", description: "Prenatal acetaminophen use linked to autism and ADHD in children.", dateAdded: "2024-05-01", score: 78, notes: "MDL 3043 in S.D.N.Y. Daubert challenges ongoing. Science still developing.", jurisdiction: "S.D. New York" },
  { id: 5, title: "Social Media Youth Addiction", source: "FTC Cases", caseType: "Consumer Protection", priority: "High", status: "MDL Pending", affectedPop: "50,000,000+ minors", company: "Meta, TikTok, Snap, Google", description: "Social media platforms designed to be addictive to minors causing mental health crisis.", dateAdded: "2024-07-22", score: 85, notes: "State AG actions + individual suits. MDL 3047 in N.D. Cal. School district claims too.", jurisdiction: "N.D. California" },
];

const Card = ({ children, className = "", onClick }) => (
  <div onClick={onClick} className={className} style={{ background: "#1e1e2e", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 20, ...(onClick ? { cursor: "pointer" } : {}) }}>{children}</div>
);

const Badge = ({ label, color }) => (
  <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: color + "22", color, border: `1px solid ${color}44` }}>{label}</span>
);

const Btn = ({ children, onClick, variant = "primary", small, style = {} }) => {
  const base = { border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: small ? 12 : 13, padding: small ? "5px 12px" : "8px 18px", transition: "all 0.2s" };
  const styles = { primary: { ...base, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }, secondary: { ...base, background: "rgba(255,255,255,0.08)", color: "#c4b5fd", border: "1px solid rgba(255,255,255,0.12)" }, danger: { ...base, background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444" } };
  return <button onClick={onClick} style={{ ...styles[variant], ...style }}>{children}</button>;
};

const Input = ({ label, value, onChange, type = "text", placeholder, style = {} }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 13, outline: "none", boxSizing: "border-box", ...style }} />
  </div>
);

const Select = ({ label, value, onChange, options, style = {} }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#1a1a2e", color: "#e0e0f0", fontSize: 13, outline: "none", boxSizing: "border-box", ...style }}>
      <option value="">All</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const TextArea = ({ label, value, onChange, rows = 3, placeholder }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
  </div>
);

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1a1a2e", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)", padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#e0e0f0", fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

const ScoreBar = ({ score }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", borderRadius: 3, background: score >= 80 ? "linear-gradient(90deg,#22c55e,#4ade80)" : score >= 60 ? "linear-gradient(90deg,#eab308,#facc15)" : "linear-gradient(90deg,#ef4444,#f87171)", transition: "width 0.5s" }} />
    </div>
    <span style={{ fontSize: 12, fontWeight: 700, color: score >= 80 ? "#4ade80" : score >= 60 ? "#facc15" : "#f87171", minWidth: 28 }}>{score}</span>
  </div>
);

const AIPanel = ({ caseData, onClose }) => {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("viability");

  const prompts = {
    viability: `You are a senior plaintiffs' attorney specializing in class actions and MDL litigation. Analyze this potential case for viability:\n\nCase: ${caseData.title}\nType: ${caseData.caseType}\nCompany: ${caseData.company}\nAffected Population: ${caseData.affectedPop}\nDescription: ${caseData.description}\nNotes: ${caseData.notes}\nJurisdiction: ${caseData.jurisdiction || "TBD"}\n\nProvide a concise analysis covering: (1) Strength of legal theories, (2) Estimated class size and damages, (3) Key challenges and defenses, (4) Recommended next steps, (5) Marketing/intake strategy for client acquisition. Be specific and actionable.`,
    marketing: `You are a legal marketing strategist for plaintiffs' firms. Create a client acquisition strategy for:\n\nCase: ${caseData.title}\nCompany: ${caseData.company}\nAffected Population: ${caseData.affectedPop}\nDescription: ${caseData.description}\n\nProvide: (1) Target demographics, (2) Key messaging and ad copy themes, (3) Recommended channels (TV, digital, social, etc.), (4) Qualifying questions for intake, (5) Geographic focus areas. Be specific and actionable.`,
    research: `You are a legal research analyst. Provide a research brief on:\n\nCase: ${caseData.title}\nType: ${caseData.caseType}\nCompany: ${caseData.company}\nDescription: ${caseData.description}\nNotes: ${caseData.notes}\n\nCover: (1) Key precedent cases and outcomes, (2) Current litigation landscape, (3) Relevant statutes and regulations, (4) Expert witness needs, (5) Discovery priorities. Be specific.`
  };

  const runAnalysis = async () => {
    setLoading(true);
    setAnalysis("");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompts[mode] }] })
      });
      const data = await r.json();
      setAnalysis(data.content?.map(b => b.text || "").join("\n") || "No response received.");
    } catch (e) {
      setAnalysis("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ marginTop: 16, background: "rgba(99,102,241,0.08)", borderRadius: 12, border: "1px solid rgba(99,102,241,0.2)", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ margin: 0, color: "#a78bfa", fontSize: 14 }}>AI Case Analysis</h4>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[["viability", "Case Viability"], ["marketing", "Client Acquisition"], ["research", "Legal Research"]].map(([k, l]) => (
          <Btn key={k} small variant={mode === k ? "primary" : "secondary"} onClick={() => setMode(k)}>{l}</Btn>
        ))}
      </div>
      <Btn onClick={runAnalysis} small style={{ marginBottom: 12 }}>{loading ? "Analyzing..." : "Run Analysis"}</Btn>
      {analysis && <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#c8c8e0", lineHeight: 1.6, maxHeight: 400, overflow: "auto", padding: 12, background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>{analysis}</div>}
    </div>
  );
};

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [cases, setCases] = useState(initCases);
  const [filterType, setFilterType] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [showAddCase, setShowAddCase] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [showAI, setShowAI] = useState({});
  const [sourceFilter, setSourceFilter] = useState("");
  const [newCase, setNewCase] = useState({ title: "", source: "", caseType: "", priority: "Medium", status: "New Lead", affectedPop: "", company: "", description: "", notes: "", score: 50, jurisdiction: "" });
  const [webResults, setWebResults] = useState([]);
  const [webLoading, setWebLoading] = useState(false);
  const [webQuery, setWebQuery] = useState("");

  // Knowledge Base state
  const [kbView, setKbView] = useState("library");
  const [kbCases, setKbCases] = useState([
    { id: 1, title: "Philips CPAP/BiPAP Device Recall", company: "Philips Respironics", type: "Medical Device", outcome: "certified", year: 2021, affectedPop: "15,000,000+", jurisdiction: "W.D. Pennsylvania", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Uniform manufacturing defect (degraded foam) across all units; same product, same defect, same harm theory nationwide.", notes: "MDL 3014. Bellwether trials underway. Massive affected population made numerosity trivial." },
    { id: 2, title: "Johnson & Johnson Talc / Baby Powder", company: "Johnson & Johnson", type: "Product Liability", outcome: "certified", year: 2018, affectedPop: "Hundreds of thousands", jurisdiction: "Multiple", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Same product formulation, same alleged asbestos contamination, same failure-to-warn theory across all plaintiffs.", notes: "Long-running MDL. J&J ultimately filed subsidiary bankruptcy to limit exposure. Settlement fund established." },
    { id: 3, title: "AFFF Firefighting Foam PFAS", company: "3M, DuPont, others", type: "Environmental/Toxic Tort", outcome: "certified", year: 2019, affectedPop: "Millions", jurisdiction: "D. South Carolina", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Same 'forever chemicals' contaminating water supplies; common liability theory across municipal and individual plaintiffs.", notes: "MDL 2873. 3M settled for $10.3B with public water systems. Individual personal injury claims ongoing." },
    { id: 4, title: "Samsung Top-Load Washer Recall", company: "Samsung Electronics", type: "Product Liability", outcome: "certified", year: 2017, affectedPop: "2,800,000+", jurisdiction: "D. New Jersey", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "CPSC recall for lids detaching at high speeds. Clear uniform defect; consumer fraud claims predominated. No individualized causation issues.", notes: "Settled. Consumer fraud + warranty class. Clean example of uniform defect certification." },
    { id: 5, title: "Zantac / Ranitidine Cancer MDL", company: "Sanofi, GSK, Pfizer, others", type: "Pharmaceutical", outcome: "denied", year: 2022, affectedPop: "Millions of users", jurisdiction: "S.D. Florida", numerosity: true, commonality: false, typicality: false, adequacy: true, keyFact: "Daubert hearing excluded all general causation experts. Without expert testimony linking ranitidine to cancer, no common question survived.", notes: "MDL 2924 dismissed after Daubert rulings. Key lesson: causation science must be bulletproof before filing." },
    { id: 6, title: "Red Bull False Advertising", company: "Red Bull GmbH", type: "Consumer Protection", outcome: "certified", year: 2014, affectedPop: "Millions of purchasers", jurisdiction: "S.D. New York", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Uniform false advertising claim ('gives you wings' / superior energy). Economic injury to all class members identical; no individual reliance required under consumer fraud statutes.", notes: "$13M settlement. Shows power of consumer fraud class actions — individual damages small but class enormous." },
    { id: 7, title: "Snap / Snapchat Speed Filter Wrongful Death", company: "Snap Inc.", type: "Product Liability", outcome: "certified", year: 2018, affectedPop: "Thousands", jurisdiction: "N.D. Georgia", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "App design feature (speed filter) encouraged dangerous driving. Negligent design theory applied uniformly; common questions predominated.", notes: "Landmark social media product liability case. Settled. Opened door to design-defect claims against social platforms." },
    { id: 8, title: "Paxil / Paroxetine Birth Defect MDL", company: "GlaxoSmithKline", type: "Pharmaceutical", outcome: "certified", year: 2004, affectedPop: "Thousands of mothers/infants", jurisdiction: "E.D. Pennsylvania", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Same drug, same label, same failure-to-warn theory. Prenatal exposure claims unified by common evidence on GSK's knowledge of birth defect risk.", notes: "GSK paid $1B+ in settlements. Classic pharma MDL with uniform label deficiency theory." },
    { id: 9, title: "Tylenol Prenatal Autism/ADHD MDL", company: "Johnson & Johnson / retailers", type: "Pharmaceutical", outcome: "pending", year: 2022, affectedPop: "Millions of users", jurisdiction: "S.D. New York", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Prenatal acetaminophen use linked to autism/ADHD. Science emerging but contested. Daubert challenges ongoing as of 2024.", notes: "MDL 3043. Outcome uncertain. Key risk: if causation science fails Daubert, same fate as Zantac." },
    { id: 10, title: "Roundup / Glyphosate Cancer Cases", company: "Monsanto / Bayer", type: "Environmental/Toxic Tort", outcome: "mixed", year: 2019, affectedPop: "125,000+ claims", jurisdiction: "N.D. California + others", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "Non-Hodgkin lymphoma linked to glyphosate herbicide. IARC classification as 'probable carcinogen' was key. Individual trials returned large verdicts ($289M, $80M, $2B).", notes: "Class cert denied federally but individual cases succeeded. Bayer set aside $10.9B for resolution. Shows mass tort can succeed even without class cert." },
  ]);
  const [kbPatterns, setKbPatterns] = useState("");
  const [kbPatternsLoading, setKbPatternsLoading] = useState(false);
  const [kbPredict, setKbPredict] = useState("");
  const [kbPredictResult, setKbPredictResult] = useState("");
  const [kbPredictLoading, setKbPredictLoading] = useState(false);
  const [showAddKb, setShowAddKb] = useState(false);
  const [newKbCase, setNewKbCase] = useState({ title: "", company: "", type: "", outcome: "certified", year: new Date().getFullYear(), affectedPop: "", jurisdiction: "", keyFact: "", notes: "" });

  const runPatternAnalysis = async () => {
    setKbPatternsLoading(true);
    setKbPatterns("");
    const caseList = kbCases.map(c => `- ${c.title} (${c.company}, ${c.year}): Outcome=${c.outcome.toUpperCase()}. Key fact: ${c.keyFact} Notes: ${c.notes}`).join("\n");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: `You are a senior class action attorney analyzing a knowledge base of historical class action and MDL cases. Here are the cases:\n\n${caseList}\n\nBased on these cases, provide:\n1. TOP 5 WINNING PATTERNS: Factual and legal patterns that consistently appear in CERTIFIED or successful cases\n2. TOP 5 FAILURE PATTERNS: What causes cases to be DENIED or fail (Zantac is the key example)\n3. IDEAL PLAINTIFF PROFILE: What characteristics make the ideal plaintiff in a product liability class action\n4. RED FLAGS: Warning signs that a potential case is too risky to pursue\n5. SWEET SPOT: The ideal fact pattern for a new product liability class action\n\nBe specific, actionable, and draw directly from the cases above.` }] })
      });
      const data = await r.json();
      setKbPatterns(data.content?.map(b => b.text || "").join("\n") || "No response.");
    } catch (e) { setKbPatterns("Error: " + e.message); }
    setKbPatternsLoading(false);
  };

  const runPredict = async () => {
    setKbPredictLoading(true);
    setKbPredictResult("");
    const caseList = kbCases.map(c => `- ${c.title}: Outcome=${c.outcome.toUpperCase()}. Key fact: ${c.keyFact}`).join("\n");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: `You are a senior plaintiffs' class action attorney. Based on this historical case knowledge base:\n\n${caseList}\n\nEvaluate this new potential case:\n\n${kbPredict}\n\nProvide:\n1. VIABILITY SCORE (0-100) with reasoning\n2. MOST SIMILAR HISTORICAL CASES from the knowledge base and what they predict\n3. RULE 23 ANALYSIS: Does it meet numerosity, commonality, typicality, adequacy?\n4. BIGGEST RISK FACTORS that could kill this case\n5. RECOMMENDATION: Pursue / Investigate Further / Pass — and why\n\nBe direct and honest, even if the answer is "don't pursue this."` }] })
      });
      const data = await r.json();
      setKbPredictResult(data.content?.map(b => b.text || "").join("\n") || "No response.");
    } catch (e) { setKbPredictResult("Error: " + e.message); }
    setKbPredictLoading(false);
  };

  const addKbCase = () => {
    setKbCases(p => [...p, { ...newKbCase, id: Date.now(), numerosity: true, commonality: true, typicality: true, adequacy: true }]);
    setNewKbCase({ title: "", company: "", type: "", outcome: "certified", year: new Date().getFullYear(), affectedPop: "", jurisdiction: "", keyFact: "", notes: "" });
    setShowAddKb(false);
  };

  const OUTCOMES = ["certified", "denied", "settled", "pending", "mixed"];

  const filtered = cases.filter(c => {
    if (filterType && c.caseType !== filterType) return false;
    if (filterPriority && c.priority !== filterPriority) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (searchQ && !JSON.stringify(c).toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const sortedCases = [...filtered].sort((a, b) => b.score - a.score);

  const addCase = () => {
    setCases(p => [...p, { ...newCase, id: Date.now(), dateAdded: new Date().toISOString().split("T")[0] }]);
    setNewCase({ title: "", source: "", caseType: "", priority: "Medium", status: "New Lead", affectedPop: "", company: "", description: "", notes: "", score: 50, jurisdiction: "" });
    setShowAddCase(false);
  };

  const updateCase = (id, updates) => setCases(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
  const deleteCase = id => { setCases(p => p.filter(c => c.id !== id)); setSelectedCase(null); };

  const searchRecalls = async () => {
    setWebLoading(true);
    setWebResults([]);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: `Search for the latest product recalls, FDA recalls, class action lawsuits, and MDL litigation developments from the past 30 days. Focus on: ${webQuery || "all recent recalls and class actions"}. Return a summary of the top findings with case names, companies involved, affected populations, and current status. Format as a structured list.` }]
        })
      });
      const data = await r.json();
      const text = data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "No results found.";
      setWebResults([{ text }]);
    } catch (e) {
      setWebResults([{ text: "Error: " + e.message }]);
    }
    setWebLoading(false);
  };

  const stats = {
    total: cases.length,
    critical: cases.filter(c => c.priority === "Critical").length,
    active: cases.filter(c => ["MDL Active", "Case Filed", "MDL Pending"].includes(c.status)).length,
    avgScore: cases.length ? Math.round(cases.reduce((s, c) => s + c.score, 0) / cases.length) : 0
  };

  const sourceCategories = [...new Set(SOURCES.map(s => s.category))];
  const filteredSources = sourceFilter ? SOURCES.filter(s => s.category === sourceFilter) : SOURCES;

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "cases", label: "Case Tracker", icon: "⚖️" },
    { id: "sources", label: "Source Monitor", icon: "🔍" },
    { id: "scanner", label: "AI Scanner", icon: "🤖" },
    { id: "knowledge", label: "Knowledge Base", icon: "🧠" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 50%,#16162a 100%)", color: "#e0e0f0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ background: "rgba(15,15,26,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚖️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.3px" }}>Class Action & MDL Analyzer</div>
            <div style={{ fontSize: 11, color: "#888" }}>Plaintiff Intelligence Platform</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: tab === t.id ? "rgba(99,102,241,0.2)" : "transparent", color: tab === t.id ? "#a78bfa" : "#888", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.2s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {tab === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
              {[
                { label: "Total Cases", val: stats.total, color: "#6366f1", icon: "📋" },
                { label: "Critical Priority", val: stats.critical, color: "#ef4444", icon: "🔴" },
                { label: "Active Litigation", val: stats.active, color: "#22c55e", icon: "⚡" },
                { label: "Avg Viability Score", val: stats.avgScore, color: "#f59e0b", icon: "📈" },
              ].map((s, i) => (
                <Card key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.val}</div>
                    </div>
                    <span style={{ fontSize: 24 }}>{s.icon}</span>
                  </div>
                </Card>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#c4b5fd" }}>Top Cases by Viability</h3>
                {[...cases].sort((a, b) => b.score - a.score).slice(0, 5).map(c => (
                  <div key={c.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#e0e0f0" }} onClick={() => { setSelectedCase(c); setTab("cases"); }}>{c.title}</span>
                      <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
                    </div>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{c.company} · {c.affectedPop}</div>
                    <ScoreBar score={c.score} />
                  </div>
                ))}
              </Card>
              <Card>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#c4b5fd" }}>Case Pipeline</h3>
                {STATUSES.map(s => {
                  const count = cases.filter(c => c.status === s).length;
                  const pct = cases.length ? (count / cases.length) * 100 : 0;
                  return (
                    <div key={s} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: STATUS_COLORS[s] }}>{s}</span>
                        <span style={{ color: "#888" }}>{count}</span>
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: STATUS_COLORS[s], borderRadius: 2, transition: "width 0.3s" }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ fontSize: 13, color: "#a0a0b8", margin: "0 0 8px" }}>By Case Type</h4>
                  {CASE_TYPES.filter(t => cases.some(c => c.caseType === t)).map(t => (
                    <div key={t} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", padding: "3px 0" }}>
                      <span>{t}</span>
                      <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{cases.filter(c => c.caseType === t).length}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === "cases" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Case Tracker</h2>
              <Btn onClick={() => setShowAddCase(true)}>+ New Case</Btn>
            </div>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 }}>
                <Input placeholder="Search cases..." value={searchQ} onChange={setSearchQ} style={{ marginBottom: 0 }} />
                <Select value={filterType} onChange={setFilterType} options={CASE_TYPES} style={{ marginBottom: 0 }} />
                <Select value={filterPriority} onChange={setFilterPriority} options={PRIORITIES} style={{ marginBottom: 0 }} />
                <Select value={filterStatus} onChange={setFilterStatus} options={STATUSES} style={{ marginBottom: 0 }} />
              </div>
            </Card>
            <div style={{ display: "grid", gap: 12 }}>
              {sortedCases.map(c => (
                <Card key={c.id} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{c.title}</span>
                        <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
                        <Badge label={c.status} color={STATUS_COLORS[c.status]} />
                      </div>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{c.company} · {c.caseType} · {c.source} · Pop: {c.affectedPop}</div>
                      <div style={{ fontSize: 13, color: "#a0a0b8", marginBottom: 8 }}>{c.description}</div>
                      <div style={{ maxWidth: 200 }}><ScoreBar score={c.score} /></div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 100 }}>
                      <div style={{ fontSize: 11, color: "#666" }}>{c.dateAdded}</div>
                      {c.jurisdiction && <div style={{ fontSize: 11, color: "#8b5cf6", marginTop: 4 }}>{c.jurisdiction}</div>}
                    </div>
                  </div>
                  {selectedCase?.id === c.id && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <Select label="Priority" value={c.priority} onChange={v => updateCase(c.id, { priority: v })} options={PRIORITIES} />
                        <Select label="Status" value={c.status} onChange={v => updateCase(c.id, { status: v })} options={STATUSES} />
                        <Input label="Viability Score (0-100)" type="number" value={c.score} onChange={v => updateCase(c.id, { score: parseInt(v) || 0 })} />
                        <Input label="Jurisdiction" value={c.jurisdiction || ""} onChange={v => updateCase(c.id, { jurisdiction: v })} />
                      </div>
                      <TextArea label="Notes" value={c.notes} onChange={v => updateCase(c.id, { notes: v })} />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <Btn small variant="secondary" onClick={() => setShowAI(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                          🤖 {showAI[c.id] ? "Hide" : "AI"} Analysis
                        </Btn>
                        <Btn small variant="danger" onClick={() => deleteCase(c.id)}>Delete</Btn>
                      </div>
                      {showAI[c.id] && <AIPanel caseData={c} onClose={() => setShowAI(p => ({ ...p, [c.id]: false }))} />}
                    </div>
                  )}
                </Card>
              ))}
              {sortedCases.length === 0 && <div style={{ textAlign: "center", color: "#666", padding: 40 }}>No cases match your filters</div>}
            </div>
            <Modal open={showAddCase} onClose={() => setShowAddCase(false)} title="Add New Case">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Case Title" value={newCase.title} onChange={v => setNewCase(p => ({ ...p, title: v }))} placeholder="e.g., XYZ Device Recall" />
                <Input label="Company/Defendant" value={newCase.company} onChange={v => setNewCase(p => ({ ...p, company: v }))} />
                <Select label="Case Type" value={newCase.caseType} onChange={v => setNewCase(p => ({ ...p, caseType: v }))} options={CASE_TYPES} />
                <Select label="Priority" value={newCase.priority} onChange={v => setNewCase(p => ({ ...p, priority: v }))} options={PRIORITIES} />
                <Select label="Status" value={newCase.status} onChange={v => setNewCase(p => ({ ...p, status: v }))} options={STATUSES} />
                <Input label="Source" value={newCase.source} onChange={v => setNewCase(p => ({ ...p, source: v }))} placeholder="e.g., FDA Recalls" />
                <Input label="Affected Population" value={newCase.affectedPop} onChange={v => setNewCase(p => ({ ...p, affectedPop: v }))} placeholder="e.g., 500,000+" />
                <Input label="Jurisdiction" value={newCase.jurisdiction} onChange={v => setNewCase(p => ({ ...p, jurisdiction: v }))} placeholder="e.g., S.D. New York" />
                <Input label="Viability Score (0-100)" type="number" value={newCase.score} onChange={v => setNewCase(p => ({ ...p, score: parseInt(v) || 0 }))} />
              </div>
              <TextArea label="Description" value={newCase.description} onChange={v => setNewCase(p => ({ ...p, description: v }))} placeholder="Brief case description..." />
              <TextArea label="Notes" value={newCase.notes} onChange={v => setNewCase(p => ({ ...p, notes: v }))} placeholder="Investigation notes, key contacts, deadlines..." />
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <Btn onClick={addCase}>Add Case</Btn>
                <Btn variant="secondary" onClick={() => setShowAddCase(false)}>Cancel</Btn>
              </div>
            </Modal>
          </div>
        )}

        {tab === "sources" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Source Monitor</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn small variant={sourceFilter === "" ? "primary" : "secondary"} onClick={() => setSourceFilter("")}>All</Btn>
                {sourceCategories.map(c => (
                  <Btn key={c} small variant={sourceFilter === c ? "primary" : "secondary"} onClick={() => setSourceFilter(c)}>{c}</Btn>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {filteredSources.map(s => (
                <Card key={s.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>{s.type}</div>
                    </div>
                    <Badge label={s.category} color={
                      s.category === "Federal" ? "#3b82f6" : s.category === "Medical" ? "#ef4444" : s.category === "Judicial" ? "#f59e0b" : s.category === "News" ? "#22c55e" : s.category === "Plaintiff Intel" ? "#8b5cf6" : s.category === "State" ? "#ec4899" : "#6b7280"
                    } />
                  </div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#6366f1", wordBreak: "break-all", textDecoration: "none" }}>
                    {s.url.replace("https://", "").substring(0, 50)}...
                  </a>
                  <div style={{ marginTop: 10 }}>
                    <Btn small variant="secondary" onClick={() => window.open(s.url, "_blank")}>Open Source ↗</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {tab === "scanner" && (
          <div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>AI Recall & Litigation Scanner</h2>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Use AI with web search to discover the latest recalls, class actions, and MDL developments.</p>
            <Card>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <input value={webQuery} onChange={e => setWebQuery(e.target.value)} placeholder="e.g., medical device recalls 2025, PFAS litigation updates, recent FDA warning letters..." style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 13, outline: "none" }} />
                <Btn onClick={searchRecalls}>{webLoading ? "Scanning..." : "Scan Now"}</Btn>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {["FDA medical device recalls 2025","Latest class action lawsuits filed","CPSC consumer product recalls","New MDL consolidation orders","Pharmaceutical adverse events","Data breach class actions","Auto defect recalls NHTSA"].map(q => (
                  <button key={q} onClick={() => setWebQuery(q)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#a0a0b8", cursor: "pointer", fontSize: 11 }}>{q}</button>
                ))}
              </div>
              {webResults.length > 0 && (
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 16, maxHeight: 500, overflow: "auto" }}>
                  {webResults.map((r, i) => (
                    <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#c8c8e0", lineHeight: 1.7 }}>{r.text}</div>
                  ))}
                </div>
              )}
              {!webResults.length && !webLoading && (
                <div style={{ textAlign: "center", color: "#555", padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
                  <div>Enter a query or click a suggestion above, then hit "Scan Now"</div>
                </div>
              )}
            </Card>
            <div style={{ marginTop: 16 }}>
              <Card>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#c4b5fd" }}>Quick Add from Scan</h3>
                <p style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>Found something promising? Add it to your case tracker.</p>
                <Btn onClick={() => { setShowAddCase(true); setTab("cases"); }}>+ Add New Case from Scan Results</Btn>
              </Card>
            </div>
          </div>
        )}

        {tab === "knowledge" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Class Action Knowledge Base</h2>
                <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Historical cases · Pattern analysis · Case predictor</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["library","📚 Case Library"],["patterns","🔬 Pattern Analysis"],["predict","🎯 Predict a Case"]].map(([v,l]) => (
                  <Btn key={v} small variant={kbView === v ? "primary" : "secondary"} onClick={() => setKbView(v)}>{l}</Btn>
                ))}
              </div>
            </div>

            {kbView === "library" && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <Btn onClick={() => setShowAddKb(true)}>+ Add Historical Case</Btn>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {kbCases.map(c => {
                    const outcomeColor = { certified: "#22c55e", denied: "#ef4444", settled: "#3b82f6", pending: "#f59e0b", mixed: "#8b5cf6" }[c.outcome] || "#6b7280";
                    return (
                      <Card key={c.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                              <Badge label={c.outcome.toUpperCase()} color={outcomeColor} />
                              <Badge label={c.type} color="#6366f1" />
                            </div>
                            <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{c.company} · {c.year} · {c.affectedPop} affected · {c.jurisdiction}</div>
                            <div style={{ fontSize: 13, color: "#c4b5fd", marginBottom: 4 }}><strong style={{ color: "#a78bfa" }}>Key Factor:</strong> {c.keyFact}</div>
                            {c.notes && <div style={{ fontSize: 12, color: "#888" }}>{c.notes}</div>}
                          </div>
                          <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "flex-end", minWidth: 60 }}>
                            {["N","C","T","A"].map((label, i) => {
                              const val = [c.numerosity, c.commonality, c.typicality, c.adequacy][i];
                              const title = ["Numerosity","Commonality","Typicality","Adequacy"][i];
                              return <span key={label} title={title} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: val ? "#22c55e22" : "#ef444422", color: val ? "#4ade80" : "#f87171", border: `1px solid ${val ? "#22c55e44" : "#ef444444"}` }}>{label}</span>;
                            })}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <Modal open={showAddKb} onClose={() => setShowAddKb(false)} title="Add Historical Case">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Input label="Case Title" value={newKbCase.title} onChange={v => setNewKbCase(p => ({ ...p, title: v }))} />
                    <Input label="Company/Defendant" value={newKbCase.company} onChange={v => setNewKbCase(p => ({ ...p, company: v }))} />
                    <Input label="Case Type" value={newKbCase.type} onChange={v => setNewKbCase(p => ({ ...p, type: v }))} placeholder="e.g., Product Liability" />
                    <Select label="Outcome" value={newKbCase.outcome} onChange={v => setNewKbCase(p => ({ ...p, outcome: v }))} options={OUTCOMES} />
                    <Input label="Year" type="number" value={newKbCase.year} onChange={v => setNewKbCase(p => ({ ...p, year: parseInt(v) }))} />
                    <Input label="Affected Population" value={newKbCase.affectedPop} onChange={v => setNewKbCase(p => ({ ...p, affectedPop: v }))} />
                    <Input label="Jurisdiction" value={newKbCase.jurisdiction} onChange={v => setNewKbCase(p => ({ ...p, jurisdiction: v }))} />
                  </div>
                  <TextArea label="Key Deciding Factor" value={newKbCase.keyFact} onChange={v => setNewKbCase(p => ({ ...p, keyFact: v }))} placeholder="What was the single most important fact that drove the outcome?" rows={2} />
                  <TextArea label="Notes" value={newKbCase.notes} onChange={v => setNewKbCase(p => ({ ...p, notes: v }))} placeholder="Settlement amounts, MDL number, key rulings..." rows={2} />
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <Btn onClick={addKbCase}>Add Case</Btn>
                    <Btn variant="secondary" onClick={() => setShowAddKb(false)}>Cancel</Btn>
                  </div>
                </Modal>
              </div>
            )}

            {kbView === "patterns" && (
              <div>
                <Card style={{ marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#c4b5fd" }}>AI Pattern Analysis</h3>
                  <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Claude will analyze all {kbCases.length} historical cases and extract winning patterns, failure patterns, the ideal plaintiff profile, and red flags.</p>
                  <Btn onClick={runPatternAnalysis}>{kbPatternsLoading ? "Analyzing patterns..." : "Run Pattern Analysis"}</Btn>
                </Card>
                {kbPatterns && (
                  <Card>
                    <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#c4b5fd" }}>Analysis Results</h3>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#c8c8e0", lineHeight: 1.7 }}>{kbPatterns}</div>
                  </Card>
                )}
                {!kbPatterns && !kbPatternsLoading && (
                  <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🔬</div>
                    <div style={{ fontSize: 14 }}>Click "Run Pattern Analysis" to extract insights from {kbCases.length} historical cases</div>
                  </div>
                )}
              </div>
            )}

            {kbView === "predict" && (
              <div>
                <Card style={{ marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#c4b5fd" }}>Case Predictor</h3>
                  <p style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>Describe a potential new case scenario. Claude will score it against the {kbCases.length} historical cases in the knowledge base.</p>
                  <TextArea
                    label="New Case Scenario"
                    value={kbPredict}
                    onChange={setKbPredict}
                    rows={6}
                    placeholder="Example: A consumer product — a popular air fryer brand — has been linked to house fires due to an overheating defect in the heating element. The CPSC has received 3,000+ complaints. The product was sold by major retailers nationwide from 2020-2024. The manufacturer has not issued a formal recall. Potential plaintiffs suffered property damage and some personal injuries..."
                  />
                  <Btn onClick={runPredict} style={{ marginTop: 8 }}>{kbPredictLoading ? "Predicting..." : "Predict Case Viability"}</Btn>
                </Card>
                {kbPredictResult && (
                  <Card>
                    <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#c4b5fd" }}>Prediction Result</h3>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#c8c8e0", lineHeight: 1.7 }}>{kbPredictResult}</div>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
