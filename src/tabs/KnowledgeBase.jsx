import { useState } from "react";
import { Card, Badge, Btn, Input, Select, TextArea, Modal, Rule23Badges } from "../components/UI.jsx";
import { OUTCOMES, INDUSTRIES, OUTCOME_COLORS, INDUSTRY_COLORS } from "../data/sources.js";

async function callClaude(prompt, maxTokens = 1500) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.text || "No response.";
}

function AIResultBox({ text }) {
  return (
    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#c8c8e0", lineHeight: 1.75, padding: "16px 20px", background: "rgba(0,0,0,0.25)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", maxHeight: 600, overflow: "auto" }}>
      {text}
    </div>
  );
}

// ─── CASE LIBRARY ─────────────────────────────────────────────────────────────

function CaseLibrary({ cases, setCases }) {
  const [search, setSearch] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCase, setNewCase] = useState({ title: "", company: "", type: "", industry: "", outcome: "certified", year: new Date().getFullYear(), affectedPop: "", jurisdiction: "", mdlNumber: "", settlementAmount: "", classSize: "", rule23bType: "b(3)", harmCategory: "physical", daubert: "n/a", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "", certDeniedReason: "", tags: "", notes: "" });

  const filtered = cases.filter(c => {
    if (filterIndustry && c.industry !== filterIndustry) return false;
    if (filterOutcome && c.outcome !== filterOutcome) return false;
    if (search) {
      const q = search.toLowerCase();
      const searchable = [c.title, c.company, c.keyFact, c.notes, c.type, ...(c.tags || [])].join(" ").toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  const addCase = () => {
    const tags = newCase.tags ? newCase.tags.split(",").map(t => t.trim()) : [];
    setCases(p => [...p, { ...newCase, id: Date.now(), tags }]);
    setNewCase({ title: "", company: "", type: "", industry: "", outcome: "certified", year: new Date().getFullYear(), affectedPop: "", jurisdiction: "", mdlNumber: "", settlementAmount: "", classSize: "", rule23bType: "b(3)", harmCategory: "physical", daubert: "n/a", numerosity: true, commonality: true, typicality: true, adequacy: true, keyFact: "", certDeniedReason: "", tags: "", notes: "" });
    setShowAdd(false);
  };

  const stats = { total: cases.length, certified: cases.filter(c => c.outcome === "certified").length, denied: cases.filter(c => c.outcome === "denied").length, settled: cases.filter(c => c.outcome === "settled").length };

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {[["Total Cases", stats.total, "#C8442F"], ["Certified", stats.certified, "#22c55e"], ["Denied", stats.denied, "#ef4444"], ["Settled", stats.settled, "#3b82f6"]].map(([label, val, color]) => (
          <Card key={label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
          </Card>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <Input placeholder="Search cases, companies, facts, tags..." value={search} onChange={setSearch} style={{ marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Select value={filterIndustry} onChange={setFilterIndustry} options={INDUSTRIES.filter(i => i !== "All")} style={{ marginBottom: 0 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <Select value={filterOutcome} onChange={setFilterOutcome} options={OUTCOMES} style={{ marginBottom: 0 }} />
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Case</Btn>
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>{filtered.length} of {cases.length} cases</div>

      {/* Industry filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Btn small variant={filterIndustry === "" ? "primary" : "secondary"} onClick={() => setFilterIndustry("")}>All</Btn>
        {Object.keys(INDUSTRY_COLORS).map(ind => (
          <Btn key={ind} small variant={filterIndustry === ind ? "primary" : "secondary"} style={filterIndustry === ind ? {} : { borderColor: INDUSTRY_COLORS[ind] + "44", color: INDUSTRY_COLORS[ind] }} onClick={() => setFilterIndustry(filterIndustry === ind ? "" : ind)}>{ind}</Btn>
        ))}
      </div>

      {/* Case list */}
      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map(c => (
          <Card key={c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)} style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, marginRight: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                  <Badge label={c.outcome.toUpperCase()} color={OUTCOME_COLORS[c.outcome] || "#6b7280"} />
                  {c.industry && <Badge label={c.industry} color={INDUSTRY_COLORS[c.industry] || "#6b7280"} />}
                  {c.mdlNumber && <Badge label={c.mdlNumber} color="#f59e0b" />}
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                  {c.company} · {c.year} · {c.affectedPop && `${c.affectedPop} affected`} {c.jurisdiction && `· ${c.jurisdiction}`}
                </div>
                <div style={{ fontSize: 13, color: "#F07868", marginBottom: 4 }}>
                  <strong style={{ color: "#E06050" }}>Key Factor: </strong>{c.keyFact}
                </div>
                {c.settlementAmount && c.settlementAmount !== "Pending" && (
                  <div style={{ fontSize: 12, color: "#4ade80", marginTop: 4 }}>
                    <strong>Settlement: </strong>{c.settlementAmount}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <Rule23Badges numerosity={c.numerosity} commonality={c.commonality} typicality={c.typicality} adequacy={c.adequacy} />
                {c.daubert !== "n/a" && (
                  <Badge label={`Daubert: ${c.daubert}`} color={c.daubert === "passed" ? "#22c55e" : c.daubert === "failed" ? "#ef4444" : "#f59e0b"} />
                )}
              </div>
            </div>

            {expanded === c.id && (
              <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                  {c.settlementAmount && <div><div style={{ fontSize: 11, color: "#888" }}>Settlement</div><div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{c.settlementAmount}</div></div>}
                  {c.classSize && <div><div style={{ fontSize: 11, color: "#888" }}>Class Size</div><div style={{ fontSize: 13, color: "#e0e0f0" }}>{c.classSize}</div></div>}
                  {c.rule23bType && <div><div style={{ fontSize: 11, color: "#888" }}>Rule 23(b)</div><div style={{ fontSize: 13, color: "#F07868" }}>{c.rule23bType}</div></div>}
                  {c.harmCategory && <div><div style={{ fontSize: 11, color: "#888" }}>Harm Type</div><div style={{ fontSize: 13, color: "#e0e0f0" }}>{c.harmCategory}</div></div>}
                  {c.leadCounsel && <div><div style={{ fontSize: 11, color: "#888" }}>Lead Counsel</div><div style={{ fontSize: 13, color: "#e0e0f0" }}>{c.leadCounsel}</div></div>}
                  {c.keyPrecedent && <div><div style={{ fontSize: 11, color: "#888" }}>Key Precedent</div><div style={{ fontSize: 13, color: "#C8442F" }}>{c.keyPrecedent}</div></div>}
                </div>
                {c.certDeniedReason && <div style={{ marginBottom: 8, padding: "8px 12px", background: "#ef444411", borderRadius: 8, border: "1px solid #ef444433" }}><strong style={{ color: "#f87171", fontSize: 12 }}>Why Denied: </strong><span style={{ fontSize: 12, color: "#f87171" }}>{c.certDeniedReason}</span></div>}
                {c.appealOutcome && c.appealOutcome !== "n/a" && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: "#888" }}>Appeal: </span><span style={{ fontSize: 12, color: "#F07868" }}>{c.appealOutcome}</span></div>}
                {c.notes && <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6 }}>{c.notes}</div>}
                {c.tags && c.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    {c.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(200,68,47,0.15)", color: "#E06050", border: "1px solid rgba(200,68,47,0.2)" }}>{tag}</span>)}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#555", padding: 40 }}>No cases match your search</div>}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Historical Case">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Case Title" value={newCase.title} onChange={v => setNewCase(p => ({ ...p, title: v }))} />
          <Input label="Company/Defendant" value={newCase.company} onChange={v => setNewCase(p => ({ ...p, company: v }))} />
          <Input label="Case Type" value={newCase.type} onChange={v => setNewCase(p => ({ ...p, type: v }))} placeholder="e.g., Product Liability" />
          <Select label="Industry" value={newCase.industry} onChange={v => setNewCase(p => ({ ...p, industry: v }))} options={Object.keys(INDUSTRY_COLORS)} />
          <Select label="Outcome" value={newCase.outcome} onChange={v => setNewCase(p => ({ ...p, outcome: v }))} options={OUTCOMES} />
          <Input label="Year" type="number" value={newCase.year} onChange={v => setNewCase(p => ({ ...p, year: parseInt(v) }))} />
          <Input label="Affected Population" value={newCase.affectedPop} onChange={v => setNewCase(p => ({ ...p, affectedPop: v }))} />
          <Input label="Jurisdiction" value={newCase.jurisdiction} onChange={v => setNewCase(p => ({ ...p, jurisdiction: v }))} />
          <Input label="MDL Number (if any)" value={newCase.mdlNumber} onChange={v => setNewCase(p => ({ ...p, mdlNumber: v }))} placeholder="e.g., MDL 2885" />
          <Input label="Settlement Amount" value={newCase.settlementAmount} onChange={v => setNewCase(p => ({ ...p, settlementAmount: v }))} placeholder="e.g., $500M or Pending" />
          <Select label="Daubert Result" value={newCase.daubert} onChange={v => setNewCase(p => ({ ...p, daubert: v }))} options={["passed", "failed", "pending", "n/a"]} />
          <Input label="Rule 23(b) Type" value={newCase.rule23bType} onChange={v => setNewCase(p => ({ ...p, rule23bType: v }))} placeholder="b(2), b(3), b(1)(b)" />
        </div>
        <Input label="Tags (comma-separated)" value={newCase.tags} onChange={v => setNewCase(p => ({ ...p, tags: v }))} placeholder="e.g., PFAS, toxic tort, MDL, FDA recall" />
        <TextArea label="Key Deciding Factor" value={newCase.keyFact} onChange={v => setNewCase(p => ({ ...p, keyFact: v }))} placeholder="The single most important fact that drove the outcome..." rows={2} />
        {newCase.outcome === "denied" && <TextArea label="Reason Denied" value={newCase.certDeniedReason} onChange={v => setNewCase(p => ({ ...p, certDeniedReason: v }))} placeholder="Why was cert denied? e.g., Daubert failure, no commonality..." rows={2} />}
        <TextArea label="Notes" value={newCase.notes} onChange={v => setNewCase(p => ({ ...p, notes: v }))} placeholder="Settlement amounts, key rulings, MDL numbers, significance..." rows={2} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Btn onClick={addCase}>Add Case</Btn>
          <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── PATTERN ANALYSIS ─────────────────────────────────────────────────────────

function PatternAnalysis({ cases }) {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("full");
  const [industry, setIndustry] = useState("");

  const filteredCases = industry ? cases.filter(c => c.industry === industry) : cases;

  const run = async () => {
    setLoading(true);
    setResult("");
    const caseList = filteredCases.map(c =>
      `• ${c.title} (${c.company}, ${c.year}) [${c.outcome.toUpperCase()}] | Industry: ${c.industry} | Daubert: ${c.daubert} | Settlement: ${c.settlementAmount || "N/A"}\n  Key: ${c.keyFact}${c.certDeniedReason ? `\n  DENIED REASON: ${c.certDeniedReason}` : ""}`
    ).join("\n\n");

    const prompts = {
      full: `You are the most experienced class action and MDL attorney in the United States. Analyze this knowledge base of ${filteredCases.length} historical class action cases${industry ? ` (${industry} industry)` : ""}:\n\n${caseList}\n\nProvide:\n\n1. TOP 7 WINNING PATTERNS: Specific factual/legal patterns present in certified or settled cases. Be concrete — reference actual cases.\n\n2. TOP 5 FAILURE PATTERNS: What kills cases. Reference actual cases (especially denied ones).\n\n3. THE DAUBERT FACTOR: Based on the cases above, what makes expert science survive vs. fail Daubert in class contexts?\n\n4. IDEAL CASE PROFILE: The perfect combination of facts for a new product liability class action in 2025.\n\n5. RED FLAGS: 5 specific warning signs that a potential case should be passed on.\n\n6. SETTLEMENT LEVERAGE FACTORS: What specific facts drive defendants to settle, and for how much?`,

      denials: `You are a senior class action attorney. Analyze ONLY the denied/failed cases in this knowledge base:\n\n${filteredCases.filter(c => c.outcome === "denied").map(c => `• ${c.title}: ${c.keyFact} | DENIED REASON: ${c.certDeniedReason || "See key fact"}`).join("\n")}\n\nProvide:\n1. THE TOP CAUSES OF CLASS ACTION FAILURE — rank them by frequency and impact\n2. DAUBERT FAILURES — what specifically goes wrong with expert science\n3. RULE 23 WEAK POINTS — which element fails most often and why\n4. HOW TO AVOID EACH FAILURE — concrete steps before filing\n5. CASE SCREENING CHECKLIST — 10 yes/no questions to vet a new case before investing resources`,

      predict: `You are a class action prediction expert. Based on this knowledge base of ${filteredCases.length} cases:\n\n${caseList}\n\nCreate a CASE SCORING RUBRIC — a structured scoring system (0-100) that can be applied to any new potential class action to predict its likelihood of success. Include:\n1. The 10 most predictive factors (each with a point value)\n2. Minimum score to pursue\n3. Score range for each recommendation (Pass/Investigate/File)\n4. How to weight Daubert risk, class size, and uniform conduct\n5. Example: Apply the rubric to score a hypothetical "generic product recall with 1M units, no deaths, economic loss only"`,
    };

    try {
      const text = await callClaude(prompts[mode], 2000);
      setResult(text);
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#F07868" }}>AI Pattern Analysis</h3>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Claude analyzes {cases.length} historical cases to extract patterns, failure modes, and a predictive scoring model.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Analysis Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["full", "Full Analysis"], ["denials", "What Kills Cases"], ["predict", "Scoring Rubric"]].map(([v, l]) => (
                <Btn key={v} small variant={mode === v ? "primary" : "secondary"} onClick={() => setMode(v)}>{l}</Btn>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Filter by Industry</div>
            <Select value={industry} onChange={setIndustry} options={Object.keys(INDUSTRY_COLORS)} style={{ marginBottom: 0, minWidth: 180 }} />
          </div>
          <Btn onClick={run} style={{ alignSelf: "flex-end" }}>{loading ? "Analyzing..." : `Run on ${filteredCases.length} Cases`}</Btn>
        </div>
      </Card>
      {result ? <Card><h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#F07868" }}>Analysis Results</h3><AIResultBox text={result} /></Card> : (
        !loading && <div style={{ textAlign: "center", color: "#555", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 12 }}>🔬</div><div>Run an analysis to extract winning patterns from {cases.length} historical cases</div></div>
      )}
    </div>
  );
}

// ─── CASE PREDICTOR ───────────────────────────────────────────────────────────

function CasePredictor({ cases }) {
  const [factPattern, setFactPattern] = useState("");
  const [industry, setIndustry] = useState("");
  const [harmType, setHarmType] = useState("");
  const [classSize, setClassSize] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult("");
    const caseList = cases.slice(0, 40).map(c => `• ${c.title} [${c.outcome.toUpperCase()}]: ${c.keyFact}`).join("\n");
    const context = [industry && `Industry: ${industry}`, harmType && `Harm Type: ${harmType}`, classSize && `Estimated Class Size: ${classSize}`].filter(Boolean).join(" | ");
    try {
      const text = await callClaude(`You are the nation's top class action attorney. Based on this knowledge base of historical cases:\n\n${caseList}\n\nEvaluate this new potential case:\n${context ? `[Context: ${context}]\n` : ""}${factPattern}\n\nProvide:\n1. VIABILITY SCORE (0-100) with explicit reasoning\n2. MOST SIMILAR HISTORICAL CASES from the knowledge base — what do they predict?\n3. RULE 23 ANALYSIS: Grade each element (A/B/C/D/F) with reasoning\n   - Numerosity: \n   - Commonality: \n   - Typicality: \n   - Adequacy: \n   - Predominance (b(3)): \n4. DAUBERT RISK ASSESSMENT: How strong is the causation science? What would plaintiffs need to prove?\n5. SETTLEMENT VALUE ESTIMATE: Based on comparable cases, what's the realistic range?\n6. BIGGEST RISKS: Top 3 things that could kill this case\n7. RECOMMENDATION: PURSUE NOW / INVESTIGATE FURTHER / PASS — with specific next steps\n\nBe direct, specific, and cite the historical cases in your analysis.`, 1800);
      setResult(text);
    } catch (e) { setResult("Error: " + e.message); }
    setLoading(false);
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#F07868" }}>Case Viability Predictor</h3>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Describe a potential new case. Claude will score it against {cases.length} historical cases and give a Rule 23 analysis, Daubert risk assessment, and settlement estimate.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Select label="Industry" value={industry} onChange={setIndustry} options={Object.keys(INDUSTRY_COLORS)} />
          <Select label="Harm Type" value={harmType} onChange={setHarmType} options={["physical", "economic", "privacy", "property", "financial"]} />
          <Input label="Estimated Class Size" value={classSize} onChange={setClassSize} placeholder="e.g., 500,000+" />
        </div>
        <TextArea label="Describe the Case Scenario" value={factPattern} onChange={setFactPattern} rows={7} placeholder="Describe: the product/drug/device, what went wrong, who was harmed and how, whether there was an FDA recall or government action, what the defendant knew and when, how many people are affected, what the legal theories would be (failure to warn, design defect, consumer fraud, etc.)..." />
        <Btn onClick={run} style={{ marginTop: 8 }}>{loading ? "Predicting..." : "Predict Case Viability"}</Btn>
      </Card>
      {result && <Card><h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#F07868" }}>Prediction</h3><AIResultBox text={result} /></Card>}
    </div>
  );
}

// ─── COURTLISTENER IMPORT ─────────────────────────────────────────────────────

function CourtListenerImport({ cases, setCases }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState({});
  const [importedIds, setImportedIds] = useState(new Set());

  const search = async () => {
    setLoading(true);
    setResults([]);
    try {
      const params = new URLSearchParams({ q: query + " class certification", type: "o", order_by: "score desc", stat_Precedential: "on", filed_after: "2000-01-01" });
      const r = await fetch(`https://www.courtlistener.com/api/rest/v3/search/?${params}`, { headers: { Accept: "application/json" } });
      const data = await r.json();
      setResults(data.results || []);
    } catch (e) { setResults([{ error: e.message }]); }
    setLoading(false);
  };

  const analyzeAndImport = async (result) => {
    setAnalyzing(p => ({ ...p, [result.id]: true }));
    try {
      const snippet = result.snippet || result.caseName || "";
      const caseText = `Case Name: ${result.caseName}\nCourt: ${result.court}\nDate: ${result.dateFiled}\nDocket: ${result.docketNumber}\nText excerpt: ${snippet}`;
      const text = await callClaude(`You are a class action attorney. Extract structured data from this case for our knowledge base.\n\n${caseText}\n\nReturn ONLY a JSON object with these exact fields (no markdown, no explanation, just the JSON):\n{"title":"...","company":"...","type":"...","industry":"Pharmaceutical|Medical Device|Auto|Consumer Products|Tech/Privacy|Financial|Environmental|Food & Beverage|Securities","outcome":"certified|denied|settled|pending|mixed","year":YYYY,"affectedPop":"...","jurisdiction":"...","mdlNumber":"...","settlementAmount":"...","rule23bType":"b(3)|b(2)|b(1)(b)|n/a","harmCategory":"physical|economic|privacy|property|financial","daubert":"passed|failed|pending|n/a","keyFact":"ONE sentence: the single most important fact that determined the outcome","certDeniedReason":"if denied, why","leadCounsel":"...","keyPrecedent":"...","notes":"2-3 sentences of context","tags":["tag1","tag2"]}`, 800);
      const json = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      const newCase = { ...json, id: Date.now() + Math.random(), numerosity: true, commonality: true, typicality: true, adequacy: true, source: "CourtListener" };
      setCases(p => [...p, newCase]);
      setImportedIds(p => new Set([...p, result.id]));
    } catch (e) { alert("Import error: " + e.message); }
    setAnalyzing(p => ({ ...p, [result.id]: false }));
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "#F07868" }}>CourtListener Import</h3>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Search the free CourtListener database of federal court opinions. Import cases with one click — Claude extracts all structured data automatically.</p>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder='e.g., "product liability class certification" or "MDL pharmaceutical" or "PFAS class action"' style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 13, outline: "none" }} />
          <Btn onClick={search}>{loading ? "Searching..." : "Search"}</Btn>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["product liability class certification", "pharmaceutical MDL class action", "medical device recall class", "data breach privacy class settlement", "consumer fraud class certification denied", "environmental PFAS class action"].map(q => (
            <button key={q} onClick={() => { setQuery(q); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#a0a0b8", cursor: "pointer", fontSize: 11 }}>{q}</button>
          ))}
        </div>
      </Card>

      {results.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {results.map((r, i) => r.error ? (
            <Card key={i}><div style={{ color: "#f87171" }}>Search error: {r.error}</div></Card>
          ) : (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, marginRight: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.caseName}</div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{r.court} · {r.dateFiled} · {r.docketNumber}</div>
                  {r.snippet && <div style={{ fontSize: 12, color: "#a0a0b8", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: r.snippet.replace(/<[^>]*>/g, "") }} />}
                </div>
                <div style={{ minWidth: 120, textAlign: "right" }}>
                  {importedIds.has(r.id) ? (
                    <Badge label="✓ Imported" color="#22c55e" />
                  ) : (
                    <Btn small onClick={() => analyzeAndImport(r)}>{analyzing[r.id] ? "AI Analyzing..." : "Import + AI Analyze"}</Btn>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && (
        <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚖️</div>
          <div>Search CourtListener to find and import real federal class action cases</div>
          <div style={{ fontSize: 12, color: "#444", marginTop: 8 }}>Free access to millions of federal court opinions</div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN KNOWLEDGE BASE TAB ──────────────────────────────────────────────────

export default function KnowledgeBase({ cases, setCases }) {
  const [view, setView] = useState("library");

  const views = [
    { id: "library", label: "📚 Case Library", desc: `${cases.length} cases` },
    { id: "patterns", label: "🔬 Pattern Analysis", desc: "AI insights" },
    { id: "predict", label: "🎯 Predict a Case", desc: "Score new scenarios" },
    { id: "import", label: "🔗 CourtListener Import", desc: "Add from federal courts" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Class Action Knowledge Base</h2>
          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>The most comprehensive class action intelligence database — {cases.length} historical cases with AI-powered pattern analysis</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {views.map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{ padding: "8px 14px", borderRadius: 8, border: view === v.id ? "1px solid rgba(200,68,47,0.5)" : "1px solid rgba(255,255,255,0.08)", background: view === v.id ? "rgba(200,68,47,0.2)" : "transparent", color: view === v.id ? "#E06050" : "#888", cursor: "pointer", fontSize: 12, fontWeight: view === v.id ? 600 : 400, textAlign: "center" }}>
              <div>{v.label}</div>
              <div style={{ fontSize: 10, color: view === v.id ? "#7c6fd0" : "#555", marginTop: 1 }}>{v.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {view === "library" && <CaseLibrary cases={cases} setCases={setCases} />}
      {view === "patterns" && <PatternAnalysis cases={cases} />}
      {view === "predict" && <CasePredictor cases={cases} />}
      {view === "import" && <CourtListenerImport cases={cases} setCases={setCases} />}
    </div>
  );
}
