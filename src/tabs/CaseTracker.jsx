import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Btn, Input, Select, TextArea, Modal, ScoreBar, AIPanel } from "../components/UI.jsx";
import { CASE_TYPES, PRIORITIES, STATUSES, PRIORITY_COLORS, STATUS_COLORS } from "../data/sources.js";

// ─── COLOR HELPERS ─────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s >= 75) return "#22c55e";
  if (s >= 55) return "#f59e0b";
  return "#ef4444";
}

function urgencyColor(u) {
  if (u === "CRITICAL") return "#ef4444";
  if (u === "HIGH") return "#f97316";
  if (u === "MEDIUM") return "#f59e0b";
  return "#6b7280";
}

function stageColor(stage) {
  if (stage === "Pre-Litigation") return "#f59e0b";
  if (stage === "Filed / Discovery") return "#3b82f6";
  if (stage === "MDL Consolidated") return "#8b5cf6";
  if (stage === "Bellwether Set") return "#f97316";
  if (stage === "Settlement Discussions") return "#22c55e";
  if (stage === "Resolved") return "#6b7280";
  return "#6b7280";
}

function gradeColor(grade) {
  if (!grade || grade === "Unknown") return "#555";
  if (grade <= "B") return "#22c55e";
  if (grade <= "C") return "#f59e0b";
  return "#ef4444";
}

// ─── MINI HELPERS ──────────────────────────────────────────────────────────────

function DataPill({ label, value, color = "#888" }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, background: `${color}12`, border: `1px solid ${color}28` }}>
      {label && <span style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>}
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SLabel({ title, color = "#C8442F" }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color, textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${color}22` }}>
      {title}
    </div>
  );
}

function InfoRow({ label, value, valueColor }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 12 }}>
      <span style={{ color: "#555", minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ color: valueColor || "#c8c8e0", lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

// ─── CASE MEMO ────────────────────────────────────────────────────────────────

function goNoGoColor(v) {
  if (v === "GO") return "#22c55e";
  if (v === "NO-GO") return "#ef4444";
  return "#f59e0b";
}

function MemoSection({ title, content, color = "#c8c8e0" }) {
  if (!content) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#C8442F", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(200,68,47,0.2)" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color, lineHeight: 1.75, whiteSpace: "pre-line" }}>{content}</div>
    </div>
  );
}

function CaseMemo({ caseData, updateCase }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const memo = caseData.caseMemo || null;
  const generatedAt = caseData.caseMemoGeneratedAt || null;

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/case-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      updateCase(caseData.id, { caseMemo: data.memo, caseMemoGeneratedAt: data.generatedAt });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [caseData, updateCase]);

  if (!memo && !loading) {
    return (
      <div style={{ marginBottom: 18 }}>
        <Btn small onClick={generate}>Generate Full Case Memo</Btn>
        {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>Error: {error}</div>}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 18, padding: "22px 16px", background: "rgba(200,68,47,0.05)", borderRadius: 10, border: "1px solid rgba(200,68,47,0.2)", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>Writing case evaluation memo...</div>
        <div style={{ fontSize: 11, color: "#555" }}>Analyzing background · legal theory · class analysis · financial model · litigation landscape · risks · recommendation</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20, border: "1px solid rgba(200,68,47,0.25)", borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 18px", background: "rgba(200,68,47,0.08)", borderBottom: "1px solid rgba(200,68,47,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#C8442F", letterSpacing: "0.1em", textTransform: "uppercase" }}>Case Evaluation Memo</span>
          {memo.goNoGo && (
            <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 10px", borderRadius: 6, background: `${goNoGoColor(memo.goNoGo)}18`, color: goNoGoColor(memo.goNoGo), border: `1px solid ${goNoGoColor(memo.goNoGo)}44` }}>
              {memo.goNoGo}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {generatedAt && <span style={{ fontSize: 10, color: "#444" }}>{new Date(generatedAt).toLocaleDateString()}</span>}
          <Btn small variant="secondary" onClick={generate} style={{ padding: "2px 10px", fontSize: 10 }}>
            {loading ? "Regenerating..." : "Regenerate"}
          </Btn>
        </div>
      </div>

      <div style={{ padding: "18px 20px" }}>
        {/* Bottom line — prominent */}
        {memo.bottomLine && (
          <div style={{ marginBottom: 20, padding: "14px 16px", background: `${goNoGoColor(memo.goNoGo)}08`, borderRadius: 8, border: `1px solid ${goNoGoColor(memo.goNoGo)}30` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: goNoGoColor(memo.goNoGo), letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Bottom Line</div>
            <div style={{ fontSize: 14, color: "#e0e0f0", lineHeight: 1.7, fontWeight: 500 }}>{memo.bottomLine}</div>
          </div>
        )}

        <MemoSection title="Background" content={memo.background} />
        <MemoSection title="Legal Theory" content={memo.legalTheory} />
        <MemoSection title="Class Analysis" content={memo.classAnalysis} />
        <MemoSection title="Financial Analysis" content={memo.financialAnalysis} color="#E06050" />
        <MemoSection title="Litigation Landscape" content={memo.litigationLandscape} />

        {/* Key Risks */}
        {memo.keyRisks?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#C8442F", textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(200,68,47,0.2)" }}>
              Key Risks
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {memo.keyRisks.map((r, i) => {
                const sColor = r.severity === "High" ? "#ef4444" : r.severity === "Medium" ? "#f59e0b" : "#22c55e";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 12, padding: "9px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", alignItems: "start" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: `${sColor}18`, color: sColor, border: `1px solid ${sColor}33`, whiteSpace: "nowrap", marginTop: 1 }}>{r.severity}</span>
                    <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>{r.risk}</div>
                    <div style={{ fontSize: 12, color: "#86efac", lineHeight: 1.5 }}>{r.mitigation}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <MemoSection title="Strategic Recommendation" content={memo.strategicRecommendation} color="#86efac" />
      </div>
    </div>
  );
}

// ─── EXPANDED DETAIL PANEL ────────────────────────────────────────────────────

function CaseDetailPanel({ c, updateCase, deleteCase, showAI, setShowAI }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>

      {/* ── CASE MEMO (AI-generated narrative) ── */}
      <CaseMemo caseData={c} updateCase={updateCase} />

      {/* ── FINANCIAL OVERVIEW ── */}
      {(c.fundEstimate || c.perClaimant || c.feeToFirm) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Financial Overview" color="#E06050" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {c.fundEstimate && (
              <div style={{ padding: "10px 14px", background: "rgba(224,96,80,0.08)", borderRadius: 8, border: "1px solid rgba(224,96,80,0.2)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Est. Fund</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E06050" }}>{c.fundEstimate}</div>
              </div>
            )}
            {c.perClaimant && (
              <div style={{ padding: "10px 14px", background: "rgba(167,139,250,0.08)", borderRadius: 8, border: "1px solid rgba(167,139,250,0.2)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Per Claimant</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#a78bfa" }}>{c.perClaimant}</div>
              </div>
            )}
            {c.feeToFirm && (
              <div style={{ padding: "10px 14px", background: "rgba(34,197,94,0.08)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Firm Fee (33%)</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>{c.feeToFirm}</div>
              </div>
            )}
          </div>
          {c.damagesTheory && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#888", lineHeight: 1.5 }}>Theory: {c.damagesTheory}</div>
          )}
        </div>
      )}

      {/* ── TIMELINE & URGENCY ── */}
      {(c.urgency || c.sol || c.yearsToResolution || c.nextMilestone) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Timeline & Urgency" color={urgencyColor(c.urgency) || "#f59e0b"} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {c.urgency && (
              <div style={{ padding: "6px 12px", borderRadius: 6, background: `${urgencyColor(c.urgency)}15`, border: `1px solid ${urgencyColor(c.urgency)}40`, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: urgencyColor(c.urgency) }}>{c.urgency} URGENCY</span>
              </div>
            )}
            {c.yearsToResolution && (
              <div style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "#888" }}>
                ~{c.yearsToResolution} yrs to resolution
              </div>
            )}
          </div>
          {c.urgencyReason && <div style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 6, lineHeight: 1.5 }}>{c.urgencyReason}</div>}
          <InfoRow label="Statute of Limitations" value={c.sol} valueColor="#fbbf24" />
          <InfoRow label="Next Milestone" value={c.nextMilestone} />
          <InfoRow label="Opportunity Window" value={c.opportunityWindow} valueColor="#f59e0b" />
        </div>
      )}

      {/* ── CASE DETAILS ── */}
      {(c.caseStage || c.causesOfAction?.length > 0 || c.existingMDLNumber || c.activeFederalCases) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Case Details" color="#3b82f6" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {c.caseStage && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: stageColor(c.caseStage) + "22", color: stageColor(c.caseStage), border: `1px solid ${stageColor(c.caseStage)}44` }}>
                {c.caseStage}
              </span>
            )}
            {c.existingMDLNumber && (
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                MDL {c.existingMDLNumber}
              </span>
            )}
          </div>
          {c.caseStageRationale && (
            <div style={{ fontSize: 12, color: "#a0a0b8", marginBottom: 8, lineHeight: 1.5 }}>{c.caseStageRationale}</div>
          )}
          {c.causesOfAction?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 5 }}>Causes of Action</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {c.causesOfAction.map((ca, i) => (
                  <span key={i} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(59,130,246,0.1)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)" }}>{ca}</span>
                ))}
              </div>
            </div>
          )}
          <InfoRow label="Active Federal Cases" value={c.activeFederalCases} />
          {c.leadFirmsInvolved?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "#555" }}>Lead firms: </span>
              <span style={{ fontSize: 11, color: "#888" }}>{c.leadFirmsInvolved.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* ── PLAINTIFF PROFILE ── */}
      {(c.targetDemographics || c.requiredInjury || c.disqualifiers) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Ideal Plaintiff Profile" color="#22c55e" />
          <InfoRow label="Demographics" value={c.targetDemographics} />
          <InfoRow label="Required condition" value={c.requiredInjury} />
          {c.disqualifiers && <InfoRow label="Disqualifiers" value={c.disqualifiers} valueColor="#f87171" />}
          {c.geographicHotspots?.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {c.geographicHotspots.map((g, i) => (
                <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.2)" }}>{g}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DEFENDANT PROFILE ── */}
      {(c.defendantFinancialHealth || c.defendantBankruptcyRisk || c.defenseLikelyStrategy) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Defendant Profile" color="#ef4444" />
          <InfoRow label="Financial health" value={c.defendantFinancialHealth} />
          <InfoRow label="Bankruptcy risk" value={c.defendantBankruptcyRisk}
            valueColor={c.defendantBankruptcyRisk === "High" ? "#ef4444" : c.defendantBankruptcyRisk === "Medium" ? "#f59e0b" : "#22c55e"} />
          {c.defenseLikelyStrategy && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>Likely defense: {c.defenseLikelyStrategy}</div>
          )}
        </div>
      )}

      {/* ── TOP RISK ── */}
      {c.topRisk && (
        <div style={{ marginBottom: 18, padding: "10px 14px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
          <SLabel title="Top Risk" color="#ef4444" />
          <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.5 }}>{c.topRisk}</div>
        </div>
      )}

      {/* ── JUDGE ── */}
      {c.assignedJudge && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Assigned Judge" color="#60a5fa" />
          <div style={{ fontSize: 13, color: "#e0e0f0", fontWeight: 600 }}>{c.assignedJudge}</div>
          {c.assignedJudgeCourt && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{c.assignedJudgeCourt}</div>}
        </div>
      )}

      {/* ── IMMEDIATE NEXT STEPS ── */}
      {c.immediateNextSteps?.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Immediate Next Steps" color="#22c55e" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 7 }}>
            {c.immediateNextSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "7px 10px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.15)", fontSize: 12, color: "#86efac", alignItems: "flex-start" }}>
                <span style={{ color: "#22c55e", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ lineHeight: 1.5 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KB INTELLIGENCE ── */}
      {(c.kbGrade || c.kbComparativeAssessment || c.kbAnalogues?.length > 0) && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="KB Historical Comparison" color="#C8442F" />
          <div style={{ display: "flex", gap: 14, marginBottom: 10, alignItems: "flex-start" }}>
            {c.kbGrade && (
              <div style={{ flexShrink: 0, width: 60, height: 60, borderRadius: 10, background: "rgba(200,68,47,0.1)", border: "2px solid rgba(200,68,47,0.3)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: gradeColor(c.kbGrade), lineHeight: 1 }}>{c.kbGrade}</div>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>KB Grade</div>
              </div>
            )}
            {c.kbComparativeAssessment && (
              <p style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.6, margin: 0, flex: 1 }}>{c.kbComparativeAssessment}</p>
            )}
          </div>
          {c.kbAnalogues?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {c.kbAnalogues.map((k, i) => (
                <div key={i} style={{ padding: "8px 12px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 7, display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#22c55e" }}>{k.rating || "?"}</span>
                    <span style={{ fontSize: 9, color: "#444" }}>KB#{k.caseId}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#86efac", marginBottom: 2 }}>{k.caseName}</div>
                    {k.settlement && <div style={{ fontSize: 11, color: "#22c55e" }}>{k.settlement}</div>}
                    {k.keyLesson && <div style={{ fontSize: 11, color: "#86efac", marginTop: 3, lineHeight: 1.4 }}>Lesson: {k.keyLesson}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {c.kbStrategicPlaybook?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, color: "#C8442F", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Strategic Playbook</div>
              {c.kbStrategicPlaybook.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#c8c8e0", lineHeight: 1.5, padding: "3px 0" }}>
                  <span style={{ color: "#C8442F", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span><span>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SCORE BREAKDOWN ── */}
      {c.scoreDimensions && (
        <div style={{ marginBottom: 18 }}>
          <SLabel title="Score Breakdown" color="#C8442F" />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[
              { key: "liabilityCertainty", label: "Liability Certainty" },
              { key: "certifiability", label: "Certifiability" },
              { key: "economicUpside", label: "Economic Upside" },
              { key: "plaintiffPipeline", label: "Plaintiff Pipeline" },
              { key: "firstMoverWindow", label: "First Mover Window" },
            ].map(({ key, label }) => {
              const val = c.scoreDimensions[key] ?? 0;
              const pct = Math.round((val / 20) * 100);
              const col = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "#666", minWidth: 140 }}>{label}</span>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, color: col, fontWeight: 700, minWidth: 24, textAlign: "right" }}>{val}</span>
                </div>
              );
            })}
          </div>
          {c.whyItScored && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#888", lineHeight: 1.6 }}>{c.whyItScored}</div>
          )}
        </div>
      )}

      {/* ── EDITABLE FIELDS ── */}
      <div style={{ marginBottom: 14 }}>
        <SLabel title="Edit Case" color="#555" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Select label="Priority" value={c.priority} onChange={v => updateCase(c.id, { priority: v })} options={PRIORITIES} />
          <Select label="Status" value={c.status} onChange={v => updateCase(c.id, { status: v })} options={STATUSES} />
          <Input label="Viability Score (0-100)" type="number" value={c.score} onChange={v => updateCase(c.id, { score: parseInt(v) || 0 })} />
          <Input label="Jurisdiction" value={c.jurisdiction || ""} onChange={v => updateCase(c.id, { jurisdiction: v })} />
        </div>
        <TextArea label="Notes" value={c.notes || ""} onChange={v => updateCase(c.id, { notes: v })} />
      </div>

      {/* ── ACTIONS ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small variant="secondary" onClick={() => setShowAI(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
          {showAI[c.id] ? "Hide" : "AI"} Analysis
        </Btn>
        {c.url && (
          <Btn small variant="secondary" onClick={() => window.open(c.url, "_blank")}>Open Source</Btn>
        )}
        <Btn small variant="danger" onClick={() => deleteCase(c.id)}>Delete</Btn>
      </div>
      {showAI[c.id] && <AIPanel caseData={c} onClose={() => setShowAI(p => ({ ...p, [c.id]: false }))} />}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function CaseTracker({ cases, setCases, selectedCase, setSelectedCase, showAI, setShowAI, caseFilter = {} }) {
  const [filterType, setFilterType] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [showAddCase, setShowAddCase] = useState(false);
  const [newCase, setNewCase] = useState({ title: "", source: "", caseType: "", priority: "Medium", status: "New Lead", affectedPop: "", company: "", description: "", notes: "", score: 50, jurisdiction: "" });

  useEffect(() => {
    if (caseFilter.status)   setFilterStatus(caseFilter.status);
    if (caseFilter.caseType) setFilterType(caseFilter.caseType);
    if (caseFilter.priority) setFilterPriority(caseFilter.priority);
  }, [caseFilter]);

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

  return (
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
          <Card key={c.id} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}
            style={{ cursor: "pointer", borderLeft: `3px solid ${scoreColor(c.score)}` }}>

            {/* ── COLLAPSED HEADER ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Row 1: title + badges */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#e0e0f0" }}>{c.title}</span>
                  <Badge label={c.priority} color={PRIORITY_COLORS[c.priority]} />
                  <Badge label={c.status} color={STATUS_COLORS[c.status]} />
                  {c.caseStage && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: stageColor(c.caseStage) + "18", color: stageColor(c.caseStage), border: `1px solid ${stageColor(c.caseStage)}33` }}>
                      {c.caseStage}
                    </span>
                  )}
                  {c.urgency && c.urgency !== "LOW" && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: `${urgencyColor(c.urgency)}18`, color: urgencyColor(c.urgency), border: `1px solid ${urgencyColor(c.urgency)}33` }}>
                      {c.urgency}
                    </span>
                  )}
                </div>

                {/* Row 2: meta */}
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                  {[c.company, c.caseType, c.jurisdiction || c.source, c.affectedPop ? `Pop: ${c.affectedPop}` : null].filter(Boolean).join(" · ")}
                </div>

                {/* Row 3: description */}
                {c.description && (
                  <div style={{ fontSize: 13, color: "#a0a0b8", marginBottom: 8, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {c.description}
                  </div>
                )}

                {/* Row 4: financial + urgency pills */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {c.fundEstimate && <DataPill label="Fund" value={c.fundEstimate} color="#E06050" />}
                  {c.perClaimant && <DataPill label="Per Claimant" value={c.perClaimant} color="#a78bfa" />}
                  {c.feeToFirm && <DataPill label="Firm Fee" value={c.feeToFirm} color="#22c55e" />}
                  {c.sol && <DataPill label="SOL" value={c.sol} color="#f59e0b" />}
                  {c.existingMDLNumber && <DataPill label="MDL" value={c.existingMDLNumber} color="#8b5cf6" />}
                  {c.assignedJudge && <DataPill label="Judge" value={c.assignedJudge.split(" ").slice(-1)[0]} color="#60a5fa" />}
                </div>

                <div style={{ maxWidth: 220 }}><ScoreBar score={c.score} /></div>
              </div>

              {/* Right column: score + KB grade + date */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0, minWidth: 80 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: scoreColor(c.score), lineHeight: 1 }}>{c.score}</div>
                {c.kbGrade && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: gradeColor(c.kbGrade) }}>{c.kbGrade}</div>
                    <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>KB Grade</div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#555" }}>{c.dateAdded}</div>
                {c.jurisdiction && <div style={{ fontSize: 11, color: "#B83E2C" }}>{c.jurisdiction}</div>}
                <div style={{ fontSize: 10, color: "#444" }}>{selectedCase?.id === c.id ? "▲ collapse" : "▼ expand"}</div>
              </div>
            </div>

            {/* ── EXPANDED DETAIL ── */}
            {selectedCase?.id === c.id && (
              <CaseDetailPanel
                c={c}
                updateCase={updateCase}
                deleteCase={deleteCase}
                showAI={showAI}
                setShowAI={setShowAI}
              />
            )}
          </Card>
        ))}
        {sortedCases.length === 0 && (
          <div style={{ textAlign: "center", color: "#666", padding: 40 }}>No cases match your filters</div>
        )}
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
  );
}
