import { useState, useEffect, useRef } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";
import { CAUSES_OF_ACTION, CA_CATEGORIES } from "../data/causeOfActionLibrary.js";
import { KB_RUBRIC } from "../lib/kbRubric.js";

// Condensed CA reference for prompts — names + element names + viability rating
const CA_REFERENCE = CAUSES_OF_ACTION.map(ca =>
  `${ca.id} | ${ca.name} | Class viability: ${ca.classActionViability?.rating?.split(" ")[0] || "—"} | Elements: ${ca.elements.map(e => e.element).join("; ")}`
).join("\n");

async function callClaude(systemPrompt, userPrompt, maxTokens = 2000) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: userPrompt, system: systemPrompt, maxTokens }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.text || "";
}

const CATEGORY_COLORS = {
  "Product Liability":   "#C8442F",
  "Consumer Protection": "#3b82f6",
  "Securities":          "#f59e0b",
  "Government Liability":"#ef4444",
  "Environmental":       "#22c55e",
  "Privacy":             "#B83E2C",
  "Employment":          "#ec4899",
  "Antitrust":           "#14b8a6",
  "Complex Litigation":  "#f97316",
  "Government Fraud":    "#E06050",
};

const VIABILITY_COLORS = {
  "A+": "#22c55e", "A": "#22c55e", "A-": "#4ade80",
  "B+": "#86efac", "B": "#f59e0b", "B-": "#f59e0b",
  "C+": "#fb923c", "C": "#fb923c",
  "D": "#ef4444", "F": "#dc2626",
  "N/A": "#6b7280",
};

function ratingFromText(text) {
  const m = text?.match(/^(A\+|A-|A|B\+|B-|B|C\+|C|D|F|N\/A)/);
  return m ? m[1] : "—";
}

function ElementRow({ el, index }) {
  return (
    <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, borderLeft: `3px solid ${el.classwide ? "#C8442F" : "#f59e0b"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>
          {index + 1}. {el.element}
        </div>
        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0, background: el.classwide ? "rgba(200,68,47,0.15)" : "rgba(245,158,11,0.15)", color: el.classwide ? "#E06050" : "#fbbf24", border: `1px solid ${el.classwide ? "#C8442F44" : "#f59e0b44"}` }}>
          {el.classwide ? "Class-wide" : "Individual"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#a0a0b8", lineHeight: 1.6, marginBottom: 4 }}>{el.description}</div>
      <div style={{ fontSize: 11, color: "#666" }}>
        <span style={{ color: "#555", fontWeight: 500 }}>Proof: </span>{el.proofRequired}
      </div>
    </div>
  );
}

function CACard({ ca, onSelect, selected }) {
  const rating = ratingFromText(ca.classActionViability?.rating);
  const color = CATEGORY_COLORS[ca.category] || "#6b7280";
  const ratingColor = VIABILITY_COLORS[rating] || "#888";

  return (
    <Card onClick={() => onSelect(ca)} style={{ cursor: "pointer", border: selected ? "1px solid rgba(200,68,47,0.5)" : "1px solid rgba(255,255,255,0.08)", background: selected ? "rgba(200,68,47,0.08)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <Badge label={ca.category} color={color} />
            <span style={{ fontSize: 11, fontWeight: 700, color: ratingColor }}>Class: {rating}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-1)", marginBottom: 4 }}>{ca.name}</div>
          <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>{ca.overview.slice(0, 140)}...</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#666" }}>{ca.elements.length} elements</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{ca.timeToResolution}</div>
        </div>
      </div>
    </Card>
  );
}

const DEMO_PROMPT = `You are a plaintiff acquisition specialist for a class action law firm. Given a cause of action, produce a realistic demographic targeting profile for the ideal plaintiff — the type of person most likely to have a valid claim and be a good client.

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "ageRange": "e.g. 35–65, median ~50",
  "gender": "e.g. 58% female / 42% male — explain why",
  "incomeClass": "e.g. Working class to lower-middle income ($25K–$65K household) — explain why",
  "geography": "e.g. Rural Southeast and Midwest industrial belt — explain why",
  "raceEthnicity": "e.g. Disproportionately affects Black and Hispanic communities due to X — be specific and explain the reason",
  "occupation": "e.g. Factory workers, veterans, agricultural laborers",
  "education": "e.g. High school diploma to some college",
  "hotspots": ["State or city 1", "State or city 2", "State or city 3", "State or city 4"],
  "whereToFindThem": ["e.g. Facebook groups for [condition]", "e.g. VA medical centers", "e.g. Spanish-language TV/radio"],
  "intakeHook": "The one-sentence hook to get them to call — what pain point resonates most",
  "qualifyingQuestion": "The single best intake screening question to confirm they have a valid claim"
}`;

function CADetail({ ca }) {
  const [section, setSection] = useState("elements");
  const [demographics, setDemographics] = useState(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const fetchedFor = useRef(null);

  useEffect(() => {
    if (section !== "plaintiff") return;
    if (fetchedFor.current === ca.id) return;
    fetchedFor.current = ca.id;
    setDemographics(null);
    setLoadingDemo(true);
    callClaude(
      DEMO_PROMPT,
      `Cause of action: ${ca.name}\nCategory: ${ca.category}\nOverview: ${ca.overview}\nIdeal plaintiff notes: ${ca.idealPlaintiffProfile}`,
      600
    ).then(text => {
      try {
        const json = JSON.parse(text.replace(/```json|```/g, "").trim());
        setDemographics(json);
      } catch {
        setDemographics({ error: text });
      }
      setLoadingDemo(false);
    }).catch(e => {
      setDemographics({ error: e.message });
      setLoadingDemo(false);
    });
  }, [section, ca.id]);

  const rating = ratingFromText(ca.classActionViability?.rating);
  const ratingColor = VIABILITY_COLORS[rating] || "#888";
  const color = CATEGORY_COLORS[ca.category] || "#6b7280";

  const sections = [
    { id: "elements", label: "Elements" },
    { id: "cert", label: "Class Cert" },
    { id: "immunity", label: "Immunity" },
    { id: "plaintiff", label: "Ideal Plaintiff" },
    { id: "redflags", label: "Red Flags" },
    { id: "precedents", label: "Precedents" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <Badge label={ca.category} color={color} />
          <span style={{ fontSize: 13, fontWeight: 700, color: ratingColor }}>Class Action Viability: {rating}</span>
          <span style={{ fontSize: 12, color: "#888" }}>{ca.timeToResolution}</span>
          <span style={{ fontSize: 12, color: "#888" }}>· {ca.feeStructure}</span>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--text-1)" }}>{ca.name}</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#a0a0b8", lineHeight: 1.65 }}>{ca.overview}</p>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10 }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: section === s.id ? "rgba(200,68,47,0.25)" : "transparent", color: section === s.id ? "#E06050" : "#888", cursor: "pointer", fontSize: 12, fontWeight: section === s.id ? 600 : 400 }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Elements */}
      {section === "elements" && (
        <div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            {ca.elements.filter(e => e.classwide).length} class-wide elements (purple) · {ca.elements.filter(e => !e.classwide).length} individual elements (amber)
          </div>
          {ca.elements.map((el, i) => <ElementRow key={i} el={el} index={i} />)}
          {ca.daubert && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171", marginBottom: 4 }}>DAUBERT / EXPERT REQUIREMENTS</div>
              <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.6 }}>{ca.daubert}</div>
            </div>
          )}
        </div>
      )}

      {/* Class Cert */}
      {section === "cert" && (
        <div>
          <div style={{ marginBottom: 12, padding: "12px 16px", background: `${ratingColor}11`, borderRadius: 10, border: `1px solid ${ratingColor}33` }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Class Action Viability Rating</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: ratingColor }}>{rating}</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{ca.classActionViability?.explanation}</div>
          </div>
          <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 6 }}>Certification Path</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>{ca.certificationPath}</div>
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Per Claimant</div>
              <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{ca.typicalDamages?.perClaimant}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Aggregate</div>
              <div style={{ fontSize: 13, color: "#4ade80", fontWeight: 600 }}>{ca.typicalDamages?.aggregate}</div>
            </div>
          </div>
        </div>
      )}

      {/* Immunity */}
      {section === "immunity" && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 6 }}>Sovereign Immunity Analysis</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>{ca.sovereignImmunity}</div>
          </div>
          {ca.sovereignImmunityWorkaround && (
            <div style={{ padding: "12px 16px", background: "rgba(34,197,94,0.05)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#4ade80", marginBottom: 6 }}>How to Get Around It</div>
              <div style={{ fontSize: 13, color: "#86efac", lineHeight: 1.65 }}>{ca.sovereignImmunityWorkaround}</div>
            </div>
          )}
        </div>
      )}

      {/* Ideal Plaintiff */}
      {section === "plaintiff" && (
        <div>
          {/* Legal qualifier text */}
          <div style={{ padding: "12px 16px", background: "rgba(200,68,47,0.07)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.18)", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#E06050", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Legal Qualifier</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>{ca.idealPlaintiffProfile}</div>
          </div>

          {/* Demographic breakdown */}
          {loadingDemo && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#555", fontSize: 13 }}>
              Generating demographic targeting profile...
            </div>
          )}

          {demographics && !demographics.error && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Who to Target</div>

              {/* Primary demographics grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                {[
                  { label: "Age Range",        value: demographics.ageRange,     color: "#C8442F" },
                  { label: "Gender Split",      value: demographics.gender,       color: "#B83E2C" },
                  { label: "Income Class",      value: demographics.incomeClass,  color: "#f59e0b" },
                  { label: "Race / Ethnicity",  value: demographics.raceEthnicity,color: "#ec4899" },
                  { label: "Occupation",        value: demographics.occupation,   color: "#3b82f6" },
                  { label: "Education",         value: demographics.education,    color: "#14b8a6" },
                ].map(d => (
                  <div key={d.label} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid ${d.color}33` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: d.color, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>{d.label}</div>
                    <div style={{ fontSize: 13, color: "#d0d0e8", lineHeight: 1.5 }}>{d.value || "—"}</div>
                  </div>
                ))}
              </div>

              {/* Geography */}
              <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Geography</div>
                <div style={{ fontSize: 13, color: "#d0d0e8", lineHeight: 1.5, marginBottom: 8 }}>{demographics.geography}</div>
                {demographics.hotspots?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {demographics.hotspots.map(h => (
                      <span key={h} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.25)" }}>{h}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Where to find them */}
              {demographics.whereToFindThem?.length > 0 && (
                <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Where to Find Them</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {demographics.whereToFindThem.map((w, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: 13, color: "#d0d0e8", lineHeight: 1.45 }}>{w}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Intake hook + qualifying question */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ padding: "12px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.2)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#E06050", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ad Hook / Key Message</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, fontStyle: "italic" }}>"{demographics.intakeHook}"</div>
                </div>
                <div style={{ padding: "12px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#4ade80", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Intake Screening Question</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, fontStyle: "italic" }}>"{demographics.qualifyingQuestion}"</div>
                </div>
              </div>
            </div>
          )}

          {demographics?.error && (
            <div style={{ fontSize: 12, color: "#ef4444", padding: 12, background: "rgba(239,68,68,0.06)", borderRadius: 8 }}>
              Failed to generate profile: {demographics.error}
            </div>
          )}

          {/* Classification signals */}
          {ca.classificationSignals?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Signals That Indicate This Cause of Action</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ca.classificationSignals.map(s => (
                  <span key={s} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.05)", color: "#a0a0b8", border: "1px solid rgba(255,255,255,0.1)" }}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Red Flags */}
      {section === "redflags" && (
        <div>
          <div style={{ marginBottom: 12 }}>
            {(ca.redFlags || []).map((rf, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, padding: "8px 12px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.15)" }}>
                <span style={{ color: "#ef4444", flexShrink: 0, fontSize: 13, fontWeight: 700 }}>!</span>
                <span style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.55 }}>{rf}</span>
              </div>
            ))}
          </div>
          {ca.watchOut && (
            <div style={{ padding: "12px 16px", background: "rgba(245,158,11,0.08)", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>WATCH OUT</div>
              <div style={{ fontSize: 13, color: "#fde68a", lineHeight: 1.65 }}>{ca.watchOut}</div>
            </div>
          )}
        </div>
      )}

      {/* Precedents */}
      {section === "precedents" && (
        <div>
          {(ca.keyPrecedents || []).map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ color: "#C8442F", flexShrink: 0, fontWeight: 700, fontSize: 13 }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ANALYZE A CASE VIEW ─────────────────────────────────────────────────────

const ANALYZE_SYSTEM = `You are the nation's leading class action attorney and plaintiff intelligence analyst with access to a comprehensive cause of action library and historical case database.

CAUSE OF ACTION REFERENCE (${CAUSES_OF_ACTION.length} causes of action in system):
${CA_REFERENCE}

VIABILITY RUBRIC (derived from 150 historical class actions):
${KB_RUBRIC}

Analyze the described scenario and return ONLY a valid JSON object (no markdown, no explanation outside JSON):
{
  "identifiedCauses": [
    { "caId": "...", "caName": "...", "confidence": "HIGH|MEDIUM|LOW", "reasoning": "1 sentence" }
  ],
  "elementsAnalysis": [
    { "element": "...", "status": "MET|LIKELY|MISSING|UNKNOWN", "evidence": "what evidence exists", "whatYouNeed": "what is still needed" }
  ],
  "viabilityScore": 0,
  "viabilityRating": "PURSUE|INVESTIGATE|PASS",
  "viabilityExplanation": "2-3 sentences citing specific rubric factors",
  "plaintiffProfile": {
    "demographics": "age range, gender, geography, occupation if relevant",
    "injuryRequired": "specific injury type and severity threshold",
    "documentationNeeded": ["item 1", "item 2", "item 3"],
    "whereToFind": ["specific community, group, platform, specialty"],
    "acquisitionStrategy": "2-3 sentences on how to find and sign up plaintiffs"
  },
  "kbAnalogues": ["case name 1", "case name 2"],
  "estimatedClassSize": "...",
  "estimatedSettlementRange": "per claimant: $X–$Y | aggregate: $X–$Y",
  "topRisks": ["risk 1", "risk 2", "risk 3"],
  "immediateNextSteps": ["step 1", "step 2", "step 3"]
}`;

const STATUS_COLORS = { MET: "#22c55e", LIKELY: "#86efac", MISSING: "#ef4444", UNKNOWN: "#f59e0b" };
const CONFIDENCE_COLORS = { HIGH: "#22c55e", MEDIUM: "#f59e0b", LOW: "#ef4444" };
const VIABILITY_BG = { PURSUE: "rgba(34,197,94,0.1)", INVESTIGATE: "rgba(245,158,11,0.1)", PASS: "rgba(239,68,68,0.1)" };
const VIABILITY_BORDER = { PURSUE: "rgba(34,197,94,0.3)", INVESTIGATE: "rgba(245,158,11,0.3)", PASS: "rgba(239,68,68,0.3)" };
const VIABILITY_COLOR = { PURSUE: "#4ade80", INVESTIGATE: "#fbbf24", PASS: "#f87171" };

function AnalyzeCaseView() {
  const [scenario, setScenario] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const EXAMPLES = [
    "A pharmaceutical company's blood pressure medication was found to contain NDMA (a carcinogen) at levels 10x above safe limits. The FDA issued a recall. 3 million patients took the drug for 2+ years. Several have developed bladder cancer. The company's internal emails show they knew about contamination 8 months before recalling.",
    "A popular fitness tracker manufacturer collected users' biometric data — heart rate, sleep patterns, GPS location — and sold it to insurance companies without user consent. 12 million US users are affected. The app's terms of service did not disclose this practice. Illinois users signed up via an in-app enrollment requiring a fingerprint scan.",
    "A major auto manufacturer installed defeat device software that made diesel vehicles pass emissions tests but emit 40x legal NOx limits in real-world driving. 500,000 vehicles sold in the US. DOJ investigation ongoing. Vehicle values have dropped 20%. Some owners in high-pollution areas have respiratory injuries.",
    "A city's police department has a documented pattern of using excessive force against residents in a specific neighborhood. DOJ investigated and found a pattern/practice of unconstitutional policing. 3 officers committed 40% of excessive force incidents. Body camera footage exists. The city refused to discipline officers despite complaints.",
  ];

  const analyze = async () => {
    if (!scenario.trim()) return;
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const text = await callClaude(ANALYZE_SYSTEM, `CASE SCENARIO:\n${scenario}`, 2500);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not parse response");
      setResult(JSON.parse(match[0]));
    } catch (e) {
      setError("Analysis failed: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 15, color: "#F07868" }}>Analyze a Potential Case</h3>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 14 }}>
          Describe the scenario — what happened, who was harmed, what the defendant did or knew. Claude will identify applicable causes of action, check each legal element, profile the ideal plaintiff, and score viability.
        </p>
        <textarea
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          rows={7}
          placeholder="Describe the case: product/drug/action involved, who was harmed and how, what defendant knew and when, government action (FDA recall, DOJ investigation, etc.), estimated affected population..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "var(--text-1)", fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Btn onClick={analyze}>{loading ? "Analyzing..." : "Analyze Case"}</Btn>
          <span style={{ fontSize: 11, color: "#555" }}>or try an example:</span>
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setScenario(ex)} style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#888", cursor: "pointer", fontSize: 11 }}>
              Example {i + 1}
            </button>
          ))}
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{error}</div>}
      </Card>

      {result && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Viability score + identified CAs */}
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
            <Card style={{ padding: 20, textAlign: "center", background: VIABILITY_BG[result.viabilityRating], border: `1px solid ${VIABILITY_BORDER[result.viabilityRating]}` }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Viability Score</div>
              <div style={{ fontSize: 52, fontWeight: 900, color: VIABILITY_COLOR[result.viabilityRating], lineHeight: 1 }}>{result.viabilityScore}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: VIABILITY_COLOR[result.viabilityRating], marginTop: 6 }}>{result.viabilityRating}</div>
              {result.estimatedClassSize && <div style={{ fontSize: 11, color: "#888", marginTop: 10 }}>Class: {result.estimatedClassSize}</div>}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 10 }}>Identified Causes of Action</div>
              {(result.identifiedCauses || []).map((ca, i) => (
                <div key={i} style={{ marginBottom: 8, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>{ca.caName}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: CONFIDENCE_COLORS[ca.confidence] + "22", color: CONFIDENCE_COLORS[ca.confidence] }}>{ca.confidence}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>{ca.reasoning}</div>
                </div>
              ))}
              {result.viabilityExplanation && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#a0a0b8", lineHeight: 1.6, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>{result.viabilityExplanation}</div>
              )}
            </Card>
          </div>

          {/* Elements checklist */}
          <Card>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 10 }}>Legal Elements Checklist</div>
            <div style={{ display: "grid", gap: 8 }}>
              {(result.elementsAnalysis || []).map((el, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 12, padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8, borderLeft: `3px solid ${STATUS_COLORS[el.status] || "#666"}` }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: (STATUS_COLORS[el.status] || "#666") + "22", color: STATUS_COLORS[el.status] || "#666" }}>{el.status}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>{el.element}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{el.evidence}</div>
                  </div>
                  <div style={{ fontSize: 11, color: el.status === "MISSING" ? "#fca5a5" : "#666" }}>
                    {el.whatYouNeed && <><span style={{ color: "#555" }}>Still need: </span>{el.whatYouNeed}</>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Plaintiff profile */}
          {result.plaintiffProfile && (
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 12 }}>Ideal Plaintiff Profile</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div style={{ padding: "10px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Demographics</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>{result.plaintiffProfile.demographics}</div>
                </div>
                <div style={{ padding: "10px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Required Injury</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>{result.plaintiffProfile.injuryRequired}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Documentation Needed</div>
                  {(result.plaintiffProfile.documentationNeeded || []).map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-2)", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{d}</div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Where to Find Plaintiffs</div>
                  {(result.plaintiffProfile.whereToFind || []).map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#4ade80", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{w}</div>
                  ))}
                </div>
              </div>
              {result.plaintiffProfile.acquisitionStrategy && (
                <div style={{ padding: "10px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.15)" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Acquisition Strategy</div>
                  <div style={{ fontSize: 13, color: "#86efac", lineHeight: 1.6 }}>{result.plaintiffProfile.acquisitionStrategy}</div>
                </div>
              )}
            </Card>
          )}

          {/* Bottom row: risks, next steps, damages, analogues */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 10 }}>Top Risks</div>
              {(result.topRisks || []).map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: "#fca5a5", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#ef4444", fontWeight: 700 }}>!</span>{r}
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#4ade80", marginBottom: 10 }}>Immediate Next Steps</div>
              {(result.immediateNextSteps || []).map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: "#86efac", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#22c55e", fontWeight: 700 }}>{i + 1}.</span>{s}
                </div>
              ))}
              {result.estimatedSettlementRange && (
                <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(34,197,94,0.08)", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Estimated settlement range</div>
                  <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 600 }}>{result.estimatedSettlementRange}</div>
                </div>
              )}
              {(result.kbAnalogues || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>KB analogues</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {result.kbAnalogues.map(a => (
                      <span key={a} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(200,68,47,0.15)", color: "#E06050", border: "1px solid rgba(200,68,47,0.25)" }}>{a}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚖️</div>
          <div>Describe a scenario above to get a full case analysis</div>
          <div style={{ fontSize: 12, color: "#444", marginTop: 8 }}>Includes: cause of action ID · elements checklist · plaintiff profile · viability score · risks · next steps</div>
        </div>
      )}
    </div>
  );
}

// ─── PREDICT VIEW ─────────────────────────────────────────────────────────────

const PREDICT_SYSTEM = `You are the world's leading class action prediction analyst. You identify early-stage signals that historically precede class action filings and predict whether a situation will result in litigation.

HISTORICAL SIGNAL PATTERNS (from 150 class actions):
- Social media complaint spike → class action filed 6–18 months later
- Government recall/enforcement action → class action filed 3–12 months later
- Investigative journalism exposé → class action filed 1–6 months later
- Multiple individual personal injury lawsuits → MDL petition within 12–24 months
- Stock price drop 10%+ + SEC investigation → securities class filed within 90 days
- DOJ criminal antitrust guilty plea → civil class action filed within 60 days
- Congressional hearing on corporate misconduct → class action filed 3–6 months later
- Class action filed in one jurisdiction → copycat cases in other jurisdictions within 90 days

VIABILITY RUBRIC:
${KB_RUBRIC}

Analyze the described signals and return ONLY a valid JSON object (no markdown):
{
  "predictionScore": 0,
  "confidence": "HIGH|MEDIUM|LOW",
  "likelyCaName": "...",
  "likelyCaId": "...",
  "timelineEstimate": "e.g., 3–6 months | 12–18 months | Already filing",
  "signalsPresent": ["signal 1", "signal 2"],
  "signalsMissing": ["missing signal 1", "missing signal 2"],
  "catalystNeeded": "The single event most likely to trigger a filing",
  "kbAnalogues": ["case name 1", "case name 2"],
  "watchFor": ["specific trigger to monitor 1", "specific trigger to monitor 2"],
  "recommendation": "MONITOR|INVESTIGATE_NOW|FILE_NOW",
  "opportunityWindow": "How long before other firms will file — time sensitivity",
  "summary": "3-4 paragraph plain English prediction explaining the score, timeline, and what to do"
}`;

const PRED_COLORS = { MONITOR: "#f59e0b", INVESTIGATE_NOW: "#C8442F", FILE_NOW: "#22c55e" };
const PRED_LABELS = { MONITOR: "Monitor — Not Yet Ready", INVESTIGATE_NOW: "Investigate Now — High Potential", FILE_NOW: "File Now — Window Open" };

function PredictView() {
  const [signals, setSignals] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const EXAMPLES = [
    "Multiple Reddit posts in r/medicine and r/personalfinance over the past 3 months about a popular SSRI antidepressant causing permanent sexual dysfunction even after stopping the medication. #PostSSRIDysfunction trending on Twitter. No FDA warning yet. A Danish study published in JAMA last month found a 12% incidence of persistent symptoms. The drug has 8M US users. Manufacturer has not responded publicly.",
    "A major bank's mobile app had a data breach 6 months ago exposing 2M customers' SSNs and account numbers. The bank sent breach notification letters. FTC has opened an investigation. Several customers have reported fraudulent accounts opened in their names. The bank is offering 1 year of free credit monitoring. No class action filed yet.",
    "NHTSA opened an investigation last month into sudden unintended acceleration in a popular EV model affecting 2023-2024 vehicles. Two deaths reported. Social media flooded with videos of the issue. NHTSA has not issued a recall yet. Manufacturer says it is 'driver error.' 180,000 vehicles affected in US.",
    "A class of 5,000 inmates was released from a state prison after the 9th Circuit found the state's mandatory minimum drug sentencing law unconstitutional. They served an average of 3 extra years under the now-void law. The state has not offered any compensation. The AG said the state has no liability.",
  ];

  const predict = async () => {
    if (!signals.trim()) return;
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const text = await callClaude(PREDICT_SYSTEM, `SIGNALS TO ANALYZE:\n${signals}`, 2000);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not parse response");
      setResult(JSON.parse(match[0]));
    } catch (e) {
      setError("Prediction failed: " + e.message);
    }
    setLoading(false);
  };

  const scoreColor = result ? (result.predictionScore >= 75 ? "#22c55e" : result.predictionScore >= 50 ? "#f59e0b" : "#ef4444") : "#888";

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 15, color: "#F07868" }}>Class Action Prediction Engine</h3>
        <p style={{ color: "#888", fontSize: 12, marginBottom: 14 }}>
          Describe what you are seeing — news reports, social media complaints, government actions, industry events. Claude will predict the probability and timeline of a class action, identify the cause of action, and tell you exactly when to move.
        </p>
        <textarea
          value={signals}
          onChange={e => setSignals(e.target.value)}
          rows={6}
          placeholder="Describe signals: news reports, social media complaints, government actions, stock movements, industry events, regulatory warnings, academic studies — anything that might signal a developing class action..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "var(--text-1)", fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Btn onClick={predict}>{loading ? "Predicting..." : "Predict"}</Btn>
          <span style={{ fontSize: 11, color: "#555" }}>or try an example:</span>
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setSignals(ex)} style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#888", cursor: "pointer", fontSize: 11 }}>
              Example {i + 1}
            </button>
          ))}
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{error}</div>}
      </Card>

      {result && (
        <div style={{ display: "grid", gap: 12 }}>

          {/* Score + recommendation */}
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
            <Card style={{ padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Prediction Score</div>
              <div style={{ fontSize: 52, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{result.predictionScore}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>Confidence: <strong style={{ color: CONFIDENCE_COLORS[result.confidence] }}>{result.confidence}</strong></div>
              {result.timelineEstimate && <div style={{ fontSize: 11, color: "#C8442F", marginTop: 8, fontWeight: 600 }}>{result.timelineEstimate}</div>}
            </Card>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 4 }}>Likely Cause of Action</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>{result.likelyCaName}</div>
                </div>
                {result.recommendation && (
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8, background: (PRED_COLORS[result.recommendation] || "#888") + "22", color: PRED_COLORS[result.recommendation] || "#888", border: `1px solid ${(PRED_COLORS[result.recommendation] || "#888")}44` }}>
                    {PRED_LABELS[result.recommendation] || result.recommendation}
                  </span>
                )}
              </div>
              {result.opportunityWindow && (
                <div style={{ padding: "8px 12px", background: "rgba(200,68,47,0.08)", borderRadius: 8, fontSize: 12, color: "#F07868", marginBottom: 10 }}>
                  <strong>Opportunity window:</strong> {result.opportunityWindow}
                </div>
              )}
              {result.catalystNeeded && (
                <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.08)", borderRadius: 8, fontSize: 12, color: "#fde68a" }}>
                  <strong>Catalyst needed:</strong> {result.catalystNeeded}
                </div>
              )}
            </Card>
          </div>

          {/* Signals present / missing */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#4ade80", marginBottom: 10 }}>Signals Present</div>
              {(result.signalsPresent || []).map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: "#86efac", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#22c55e" }}>✓</span>{s}
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171", marginBottom: 10 }}>Signals Missing</div>
              {(result.signalsMissing || []).map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: "#fca5a5", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#ef4444" }}>○</span>{s}
                </div>
              ))}
            </Card>
          </div>

          {/* Watch for + analogues */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", marginBottom: 10 }}>Watch For These Triggers</div>
              {(result.watchFor || []).map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: "#fde68a", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#f59e0b", fontWeight: 700 }}>→</span>{w}
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 10 }}>KB Historical Analogues</div>
              {(result.kbAnalogues || []).map((a, i) => (
                <div key={i} style={{ fontSize: 12, color: "#F07868", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                  <span style={{ color: "#C8442F" }}>{i + 1}.</span>{a}
                </div>
              ))}
            </Card>
          </div>

          {/* Summary */}
          {result.summary && (
            <Card>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#E06050", marginBottom: 10 }}>Analysis Summary</div>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{result.summary}</div>
            </Card>
          )}
        </div>
      )}

      {!result && !loading && (
        <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔮</div>
          <div>Describe signals above to predict whether a class action is forming</div>
          <div style={{ fontSize: 12, color: "#444", marginTop: 8 }}>Score 0–100 · Timeline · Cause of action · Signals present/missing · KB analogues</div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function CaseIntelligence() {
  const [view, setView] = useState("library");
  const [selectedCA, setSelectedCA] = useState(CAUSES_OF_ACTION[0]);
  const [filterCategory, setFilterCategory] = useState("");
  const [search, setSearch] = useState("");

  const filtered = CAUSES_OF_ACTION.filter(ca => {
    if (filterCategory && ca.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (ca.name + ca.overview + ca.category + (ca.classificationSignals || []).join(" ")).toLowerCase().includes(q);
    }
    return true;
  });

  const views = [
    { id: "library",  label: "CA Library",       desc: `${CAUSES_OF_ACTION.length} causes of action` },
    { id: "analyze",  label: "Analyze a Case",    desc: "Elements + plaintiff profile" },
    { id: "predict",  label: "Predict",           desc: "Will this become a class action?" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Case Intelligence</h2>
          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
            Legal elements library · AI case analysis · Class action prediction engine
          </p>
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

      {view === "analyze" && <AnalyzeCaseView />}
      {view === "predict" && <PredictView />}

      {view === "library" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
          <div>
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search causes of action..."
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-1)", fontSize: 12, outline: "none" }}
              />
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-1)", fontSize: 12, cursor: "pointer" }}
              >
                <option value="">All categories</option>
                {CA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>{filtered.length} of {CAUSES_OF_ACTION.length} causes of action</div>
            <div style={{ display: "grid", gap: 8 }}>
              {filtered.map(ca => (
                <CACard key={ca.id} ca={ca} onSelect={setSelectedCA} selected={selectedCA?.id === ca.id} />
              ))}
            </div>
          </div>
          <div style={{ position: "sticky", top: 80 }}>
            {selectedCA ? (
              <Card><CADetail ca={selectedCA} /></Card>
            ) : (
              <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚖️</div>
                <div>Select a cause of action to view its legal elements and analysis</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
