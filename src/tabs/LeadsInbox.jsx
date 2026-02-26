import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Btn, ScoreBar } from "../components/UI.jsx";

const CASE_TYPES = [
  "Medical Device", "Pharmaceutical", "Auto Defect", "Environmental",
  "Consumer Fraud", "Data Breach", "Securities", "Food Safety",
  "Financial Products", "Employment", "Antitrust", "Government Liability", "Other",
];

const SOURCE_CATEGORIES = ["Federal", "Judicial", "News", "Social", "Medical"];

// ─── COLOR HELPERS ────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s >= 75) return "#22c55e";
  if (s >= 55) return "#f59e0b";
  return "#ef4444";
}

function classColor(c) {
  if (c === "CREATE") return "#22c55e";
  if (c === "INVESTIGATE") return "#f59e0b";
  return "#ef4444";
}

function urgencyColor(u) {
  if (u === "CRITICAL") return "#ef4444";
  if (u === "HIGH") return "#f97316";
  if (u === "MEDIUM") return "#f59e0b";
  return "#6b7280";
}

function severityColor(s) {
  if (s === "High") return "#ef4444";
  if (s === "Medium") return "#f59e0b";
  return "#22c55e";
}

function strengthColor(s) {
  if (s === "Strong") return "#22c55e";
  if (s === "Moderate") return "#f59e0b";
  return "#ef4444";
}

// ─── SECTION COMPONENTS ───────────────────────────────────────────────────────

function Section({ title, children, accent = "#C8442F" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: accent, textTransform: "uppercase", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${accent}22` }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, valueColor }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 12 }}>
      <span style={{ color: "#666", minWidth: 140, flexShrink: 0 }}>{label}</span>
      <span style={{ color: valueColor || "#c8c8e0", lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function TagList({ items, color = "#C8442F" }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: `${color}18`, color, border: `1px solid ${color}33` }}>{item}</span>
      ))}
    </div>
  );
}

function SignalItem({ text, type }) {
  const colors = { present: "#22c55e", missing: "#ef4444", watch: "#f59e0b", strengthen: "#3b82f6" };
  const icons = { present: "✓", missing: "✗", watch: "◎", strengthen: "↑" };
  const color = colors[type] || "#888";
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 12, alignItems: "flex-start" }}>
      <span style={{ color, fontWeight: 700, flexShrink: 0, minWidth: 14 }}>{icons[type]}</span>
      <span style={{ color: "#c8c8e0", lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function RiskRow({ risk }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto 1fr", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, alignItems: "start" }}>
      <span style={{ color: "#c8c8e0" }}>{risk.risk}</span>
      <span style={{ padding: "1px 6px", borderRadius: 4, background: `${severityColor(risk.severity)}22`, color: severityColor(risk.severity), fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{risk.severity}</span>
      <span style={{ padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#888", fontSize: 10, whiteSpace: "nowrap" }}>{risk.likelihood}</span>
      <span style={{ color: "#888", lineHeight: 1.4 }}>{risk.mitigation}</span>
    </div>
  );
}

// ─── INTELLIGENCE REPORT (expanded view) ─────────────────────────────────────

function IntelligenceReport({ lead, onDismiss, onAddToTracker }) {
  const a = lead.analysis || {};

  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>

      {a.executiveSummary && (
        <Section title="Executive Summary" accent="#C8442F">
          <p style={{ fontSize: 13, color: "#c8c8e0", lineHeight: 1.7, margin: 0 }}>{a.executiveSummary}</p>
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.causesOfAction && a.causesOfAction.length > 0 && (
          <Section title="Causes of Action" accent="#B83E2C">
            {a.causesOfAction.map((ca, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: "#c8c8e0", flex: 1, lineHeight: 1.4 }}>{ca.name}</span>
                <span style={{ marginLeft: 8, color: strengthColor(ca.strength), fontWeight: 600, fontSize: 11, flexShrink: 0 }}>{ca.strength}</span>
              </div>
            ))}
          </Section>
        )}

        {a.classProfile && (
          <Section title="Class Profile" accent="#3b82f6">
            <InfoRow label="Estimated size" value={a.classProfile.estimatedSize} />
            <InfoRow label="Size confidence" value={a.classProfile.sizeConfidence} />
            <InfoRow label="Geographic scope" value={a.classProfile.geographicScope} />
            {a.classProfile.commonalityStrength && (
              <div style={{ fontSize: 12, color: "#c8c8e0", marginTop: 4, lineHeight: 1.5 }}>{a.classProfile.commonalityStrength}</div>
            )}
          </Section>
        )}
      </div>

      {a.plaintiffProfile && (
        <Section title="Ideal Plaintiff Profile" accent="#22c55e">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <InfoRow label="Demographics" value={a.plaintiffProfile.demographics} />
              <InfoRow label="Required injury" value={a.plaintiffProfile.requiredInjury} />
              <InfoRow label="Injury timeframe" value={a.plaintiffProfile.injuryTimeframe} />
              {a.plaintiffProfile.disqualifiers && (
                <InfoRow label="Disqualifiers" value={a.plaintiffProfile.disqualifiers} valueColor="#f87171" />
              )}
            </div>
            <div>
              {a.plaintiffProfile.documentationNeeded?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Documentation needed</div>
                  {a.plaintiffProfile.documentationNeeded.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 2 }}>• {d}</div>
                  ))}
                </div>
              )}
              {a.plaintiffProfile.whereToFind?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Where to find plaintiffs</div>
                  <TagList items={a.plaintiffProfile.whereToFind} color="#22c55e" />
                </div>
              )}
            </div>
          </div>
          {a.plaintiffProfile.acquisitionHook && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.2)" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Acquisition hook</div>
              <div style={{ fontSize: 13, color: "#86efac", fontStyle: "italic" }}>"{a.plaintiffProfile.acquisitionHook}"</div>
            </div>
          )}
          {a.plaintiffProfile.geographicHotspots?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Geographic hotspots</div>
              <TagList items={a.plaintiffProfile.geographicHotspots} color="#3b82f6" />
            </div>
          )}
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.defendantProfile && (
          <Section title="Defendant Profile" accent="#ef4444">
            <InfoRow label="Entity" value={a.defendantProfile.name} />
            <InfoRow label="Financial health" value={a.defendantProfile.financialHealth} />
            <InfoRow label="Bankruptcy risk" value={a.defendantProfile.bankruptcyRisk}
              valueColor={a.defendantProfile.bankruptcyRisk === "High" ? "#ef4444" : a.defendantProfile.bankruptcyRisk === "Medium" ? "#f59e0b" : "#22c55e"} />
            {a.defendantProfile.assetProtectionRisk && a.defendantProfile.assetProtectionRisk !== "None" && (
              <InfoRow label="Asset protection" value={a.defendantProfile.assetProtectionRisk} valueColor="#f87171" />
            )}
            <InfoRow label="Prior litigation" value={a.defendantProfile.priorLitigation} />
            {a.defendantProfile.defenseLikelyStrategy && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Likely defense</div>
                <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>{a.defendantProfile.defenseLikelyStrategy}</div>
              </div>
            )}
            {a.defendantProfile.vulnerability && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>Vulnerability</div>
                <div style={{ fontSize: 12, color: "#86efac", lineHeight: 1.4 }}>{a.defendantProfile.vulnerability}</div>
              </div>
            )}
          </Section>
        )}

        {a.regulatoryStatus && (
          <Section title="Regulatory Status" accent="#f59e0b">
            {a.regulatoryStatus.recallIssued && (
              <div style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(239,68,68,0.1)", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", fontSize: 11, color: "#fca5a5", fontWeight: 600 }}>
                RECALL ISSUED — {a.regulatoryStatus.recallClass || ""}
              </div>
            )}
            {a.regulatoryStatus.fdaAction && <InfoRow label="FDA" value={a.regulatoryStatus.fdaAction} />}
            {a.regulatoryStatus.cpscAction && <InfoRow label="CPSC" value={a.regulatoryStatus.cpscAction} />}
            {a.regulatoryStatus.nhtsaAction && <InfoRow label="NHTSA" value={a.regulatoryStatus.nhtsaAction} />}
            {a.regulatoryStatus.epaAction && <InfoRow label="EPA" value={a.regulatoryStatus.epaAction} />}
            {a.regulatoryStatus.secAction && <InfoRow label="SEC" value={a.regulatoryStatus.secAction} />}
            {a.regulatoryStatus.dojAction && <InfoRow label="DOJ" value={a.regulatoryStatus.dojAction} />}
            {a.regulatoryStatus.stateAgAction && <InfoRow label="State AG" value={a.regulatoryStatus.stateAgAction} />}
            {a.regulatoryStatus.governmentInvestigation && (
              <InfoRow label="Gov. investigation" value={a.regulatoryStatus.governmentInvestigation} />
            )}
          </Section>
        )}

        {a.existingLitigation && (
          <Section title="Existing Litigation" accent="#3b82f6">
            {a.existingLitigation.mdlConsolidated && (
              <div style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(59,130,246,0.1)", borderRadius: 4, fontSize: 11, color: "#93c5fd", fontWeight: 600 }}>
                MDL CONSOLIDATED {a.existingMDLNumber ? `— MDL ${a.existingMDLNumber}` : ""}
              </div>
            )}
            <InfoRow label="Active cases" value={a.existingLitigation.activeFederalCases} />
            <InfoRow label="Settlement status" value={a.existingLitigation.settlementStatus} />
            {a.existingLitigation.leadFirmsInvolved?.filter(Boolean).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Lead firms</div>
                <TagList items={a.existingLitigation.leadFirmsInvolved} color="#3b82f6" />
              </div>
            )}
            {a.existingLitigation.opportunityAssessment && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#93c5fd", lineHeight: 1.4 }}>{a.existingLitigation.opportunityAssessment}</div>
            )}
          </Section>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.damagesModel && (
          <Section title="Damages Model" accent="#E06050">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              {a.damagesModel.perClaimantRange && (
                <div style={{ padding: "8px 10px", background: "rgba(167,139,250,0.08)", borderRadius: 6, border: "1px solid rgba(167,139,250,0.2)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Per Claimant</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E06050" }}>{a.damagesModel.perClaimantRange}</div>
                </div>
              )}
              {a.damagesModel.totalFundEstimate && (
                <div style={{ padding: "8px 10px", background: "rgba(167,139,250,0.08)", borderRadius: 6, border: "1px solid rgba(167,139,250,0.2)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Total Fund</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E06050" }}>{a.damagesModel.totalFundEstimate}</div>
                </div>
              )}
            </div>
            {a.damagesModel.feeToFirmAt33Pct && (
              <InfoRow label="Fee to firm (33%)" value={a.damagesModel.feeToFirmAt33Pct} valueColor="#22c55e" />
            )}
            {a.damagesModel.theory && <InfoRow label="Damages theory" value={a.damagesModel.theory} />}
            {a.damagesModel.comcastNote && (
              <div style={{ fontSize: 11, color: a.damagesModel.comcastCompliant ? "#86efac" : "#fca5a5", marginTop: 4, lineHeight: 1.4 }}>
                Comcast compliance: {a.damagesModel.comcastNote}
              </div>
            )}
          </Section>
        )}

        {a.timeline && (
          <Section title="Timeline & Urgency" accent={urgencyColor(a.timeline.urgencyLevel)}>
            {a.timeline.urgencyLevel && (
              <div style={{ marginBottom: 8, padding: "6px 10px", background: `${urgencyColor(a.timeline.urgencyLevel)}18`, borderRadius: 6, border: `1px solid ${urgencyColor(a.timeline.urgencyLevel)}44`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: urgencyColor(a.timeline.urgencyLevel) }}>{a.timeline.urgencyLevel} URGENCY</span>
                {a.timeline.yearsToResolution && (
                  <span style={{ fontSize: 11, color: "#888" }}>{a.timeline.yearsToResolution} years est.</span>
                )}
              </div>
            )}
            {a.timeline.urgencyReason && (
              <div style={{ fontSize: 12, color: "#c8c8e0", marginBottom: 8, lineHeight: 1.4 }}>{a.timeline.urgencyReason}</div>
            )}
            {a.timeline.statuteOfLimitationsNote && (
              <InfoRow label="SOL" value={a.timeline.statuteOfLimitationsNote} valueColor="#fbbf24" />
            )}
            {a.timeline.nextMilestone && <InfoRow label="Next milestone" value={a.timeline.nextMilestone} />}
            {a.timeline.opportunityWindow && (
              <InfoRow label="Opportunity window" value={a.timeline.opportunityWindow} valueColor="#f59e0b" />
            )}
          </Section>
        )}
      </div>

      {a.signalsAnalysis && (
        <Section title="Signal Analysis" accent="#C8442F">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              {a.signalsAnalysis.present?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 4, fontWeight: 600 }}>Present</div>
                  {a.signalsAnalysis.present.map((s, i) => <SignalItem key={i} text={s} type="present" />)}
                </div>
              )}
              {a.signalsAnalysis.strengthening?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#3b82f6", marginBottom: 4, fontWeight: 600 }}>Strengthening</div>
                  {a.signalsAnalysis.strengthening.map((s, i) => <SignalItem key={i} text={s} type="strengthen" />)}
                </div>
              )}
            </div>
            <div>
              {a.signalsAnalysis.missing?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 4, fontWeight: 600 }}>Missing</div>
                  {a.signalsAnalysis.missing.map((s, i) => <SignalItem key={i} text={s} type="missing" />)}
                </div>
              )}
              {a.signalsAnalysis.watchFor?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4, fontWeight: 600 }}>Watch For</div>
                  {a.signalsAnalysis.watchFor.map((s, i) => <SignalItem key={i} text={s} type="watch" />)}
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {a.riskMatrix && a.riskMatrix.length > 0 && (
        <Section title="Risk Matrix" accent="#ef4444">
          <div style={{ fontSize: 11, color: "#444", marginBottom: 6, display: "grid", gridTemplateColumns: "1fr auto auto 1fr", gap: 8 }}>
            <span>Risk</span><span>Severity</span><span>Likelihood</span><span>Mitigation</span>
          </div>
          {a.riskMatrix.map((r, i) => <RiskRow key={i} risk={r} />)}
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {a.analogousCases?.length > 0 && (
          <Section title="KB Analogues" accent="#E06050">
            <TagList items={a.analogousCases} color="#E06050" />
          </Section>
        )}
        {a.whyItScored && (
          <Section title="Scoring Rationale" accent="#C8442F">
            <p style={{ fontSize: 12, color: "#c8c8e0", lineHeight: 1.6, margin: 0 }}>{a.whyItScored}</p>
          </Section>
        )}
      </div>

      {a.immediateNextSteps?.length > 0 && (
        <Section title="Immediate Next Steps" accent="#22c55e">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {a.immediateNextSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", background: "rgba(34,197,94,0.06)", borderRadius: 6, border: "1px solid rgba(34,197,94,0.15)", fontSize: 12, color: "#86efac", alignItems: "flex-start" }}>
                <span style={{ color: "#22c55e", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ lineHeight: 1.5 }}>{step}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.topRisk && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)" }}>
          <span style={{ fontSize: 11, color: "#888" }}>Top Risk: </span>
          <span style={{ fontSize: 13, color: "#fca5a5" }}>{a.topRisk}</span>
        </div>
      )}

      {lead.description && (
        <Section title="Source Excerpt" accent="#333">
          <p style={{ fontSize: 12, color: "#555", lineHeight: 1.6, margin: 0 }}>
            {lead.description.slice(0, 500)}{lead.description.length > 500 ? "..." : ""}
          </p>
        </Section>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
        <Btn small onClick={() => onAddToTracker(lead)}>+ Add to Case Tracker</Btn>
        {lead.url && (
          <Btn small variant="secondary" onClick={() => window.open(lead.url, "_blank")}>Open Source</Btn>
        )}
        <Btn small variant="danger" onClick={() => onDismiss(lead.id)}>Dismiss</Btn>
      </div>
    </div>
  );
}

// ─── LEAD CARD ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onDismiss, onAddToTracker }) {
  const [expanded, setExpanded] = useState(false);
  const a = lead.analysis || {};
  const urgency = a.timeline?.urgencyLevel;

  return (
    <Card style={{ cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor(a.score || 0), lineHeight: 1 }}>{a.score ?? "—"}</span>
              {a.confidence != null && (
                <span style={{ fontSize: 10, color: "#666" }}>/ {a.confidence}% conf</span>
              )}
            </div>
            {a.classification && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: classColor(a.classification) + "22", color: classColor(a.classification), border: `1px solid ${classColor(a.classification)}44` }}>
                {a.classification}
              </span>
            )}
            {a.joinOrCreate && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: a.joinOrCreate === "JOIN" ? "rgba(59,130,246,0.15)" : "rgba(184,62,44,0.15)", color: a.joinOrCreate === "JOIN" ? "#60a5fa" : "#E06050", border: `1px solid ${a.joinOrCreate === "JOIN" ? "#3b82f644" : "#B83E2C44"}` }}>
                {a.joinOrCreate}
              </span>
            )}
            {urgency && urgency !== "LOW" && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: `${urgencyColor(urgency)}18`, color: urgencyColor(urgency), border: `1px solid ${urgencyColor(urgency)}44` }}>
                {urgency}
              </span>
            )}
            {a.caseType && <Badge label={a.caseType} color="#C8442F" />}
            {a.subCategory && <Badge label={a.subCategory} color="#B83E2C" />}
          </div>

          <div style={{ fontWeight: 600, fontSize: 14, color: "#e0e0f0", marginBottom: 4, lineHeight: 1.4 }}>
            {a.headline || lead.title}
          </div>

          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>
            {lead.source} · {new Date(lead.pubDate || lead.scannedAt).toLocaleDateString()}
          </div>

          {a.executiveSummary && (
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 4 }}>
              {a.executiveSummary.slice(0, 180)}{a.executiveSummary.length > 180 ? "..." : ""}
            </div>
          )}

          {a.topRisk && (
            <div style={{ fontSize: 11, color: "#fbbf24", display: "flex", gap: 4, alignItems: "flex-start" }}>
              <span style={{ opacity: 0.6 }}>Top risk:</span> {a.topRisk}
            </div>
          )}

          {a.damagesModel?.totalFundEstimate && (
            <div style={{ fontSize: 11, color: "#E06050", marginTop: 3 }}>
              Est. fund: {a.damagesModel.totalFundEstimate}
              {a.damagesModel.feeToFirmAt33Pct && ` · Fee: ${a.damagesModel.feeToFirmAt33Pct}`}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <ScoreBar score={a.score || 0} />
          <div style={{ fontSize: 10, color: "#444" }}>{expanded ? "▲ collapse" : "▼ expand"}</div>
        </div>
      </div>

      {expanded && (
        <IntelligenceReport lead={lead} onDismiss={onDismiss} onAddToTracker={onAddToTracker} />
      )}
    </Card>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function LeadsInbox({ onAddCase, setCases, cases }) {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState("");

  const [minScore, setMinScore] = useState(50);
  const [filterClass, setFilterClass] = useState("");
  const [filterJoinCreate, setFilterJoinCreate] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCaseType, setFilterCaseType] = useState("");
  const [filterUrgency, setFilterUrgency] = useState("");

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ minScore, limit: "100" });
      if (filterClass) params.set("classification", filterClass);
      if (filterJoinCreate) params.set("joinOrCreate", filterJoinCreate);
      if (filterCategory) params.set("category", filterCategory);
      if (filterCaseType) params.set("caseType", filterCaseType);

      const [leadsRes, statsRes] = await Promise.all([
        fetch(`/api/leads?${params}`),
        fetch("/api/leads?stats=1"),
      ]);
      const leadsData = await leadsRes.json();
      const statsData = await statsRes.json();
      setLeads(leadsData.leads || []);
      setStats(statsData);
    } catch (e) {
      setError("Cannot connect to backend. Deploy to Vercel and enable KV.");
    }
    setLoading(false);
  }, [minScore, filterClass, filterJoinCreate, filterCategory, filterCaseType]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const triggerScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan");
      const data = await res.json();
      setScanResult(data);
      await fetchLeads();
    } catch (e) {
      setError("Scan failed: " + e.message);
    }
    setScanning(false);
  };

  const dismissLead = async (id) => {
    try {
      await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
      setLeads(l => l.filter(lead => lead.id !== id));
    } catch (e) {
      console.error("Dismiss failed:", e);
    }
  };

  const addToTracker = (lead) => {
    const a = lead.analysis || {};
    const newCase = {
      id: Date.now(),
      title: a.headline || lead.title,
      company: a.defendantProfile?.name || "",
      type: a.caseType || "Product Liability",
      priority: (a.score || 0) >= 75 ? "Critical" : (a.score || 0) >= 60 ? "High" : "Medium",
      status: "New Lead",
      source: lead.source,
      affectedPop: a.classProfile?.estimatedSize || "",
      jurisdiction: a.classProfile?.geographicScope || "",
      score: a.score || 50,
      description: a.executiveSummary || lead.description || "",
      notes: [
        `KB Analogues: ${(a.analogousCases || []).join(", ")}`,
        `Top Risk: ${a.topRisk || ""}`,
        `Damages: Per claimant ${a.damagesModel?.perClaimantRange || "unknown"} · Fund ${a.damagesModel?.totalFundEstimate || "unknown"}`,
        `Timeline: ${a.timeline?.yearsToResolution || "?"} years · Urgency: ${a.timeline?.urgencyLevel || "unknown"}`,
        `SOL: ${a.timeline?.statuteOfLimitationsNote || "unknown"}`,
        `Plaintiff: ${a.plaintiffProfile?.demographics || "unknown"}`,
        `Defendant: ${a.defendantProfile?.name || "unknown"} — Bankruptcy risk: ${a.defendantProfile?.bankruptcyRisk || "unknown"}`,
        `Recommendation: ${a.recommendedAction || ""}`,
        `Source URL: ${lead.url || ""}`,
      ].filter(Boolean).join("\n"),
      dateAdded: new Date().toISOString().slice(0, 10),
    };
    if (setCases) setCases(prev => [newCase, ...prev]);
    if (onAddCase) onAddCase();
  };

  const visibleLeads = leads
    .filter(l => !filterUrgency || l.analysis?.timeline?.urgencyLevel === filterUrgency)
    .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

  const highCount = leads.filter(l => (l.analysis?.score || 0) >= 75).length;
  const criticalCount = leads.filter(l => l.analysis?.timeline?.urgencyLevel === "CRITICAL").length;
  const createCount = leads.filter(l => l.analysis?.joinOrCreate === "CREATE").length;
  const joinCount = leads.filter(l => l.analysis?.joinOrCreate === "JOIN").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Leads Inbox</h2>
          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
            50+ sources monitored daily — federal agencies, courts, news, Reddit, social media, medical journals, SEC filings
            {stats?.lastScan ? ` · Last scan: ${new Date(stats.lastScan.timestamp).toLocaleString()}` : ""}
            {stats?.lastScan?.sourcesQueried ? ` · ${stats.lastScan.sourcesQueried} sources queried` : ""}
          </p>
        </div>
        <Btn onClick={triggerScan} style={{ flexShrink: 0 }}>
          {scanning ? "Scanning..." : "Run Scan Now"}
        </Btn>
      </div>

      {scanResult && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(34,197,94,0.08)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)", fontSize: 13, color: "#86efac" }}>
          Scan complete: {scanResult.processed} items fetched · {scanResult.newItems} new · {scanResult.passedTriage} passed triage · {scanResult.newLeads} deep-analyzed.
          {scanResult.topLeads?.[0] && <span> Top: <strong>{scanResult.topLeads[0].headline}</strong> (score {scanResult.topLeads[0].score}, {scanResult.topLeads[0].urgency})</span>}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, color: "#f87171" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          ["Total Leads", leads.length, "#C8442F"],
          ["Critical Urgency", criticalCount, "#ef4444"],
          ["High Priority (75+)", highCount, "#22c55e"],
          ["CREATE Opportunities", createCount, "#E06050"],
          ["JOIN Existing Cases", joinCount, "#3b82f6"],
        ].map(([label, val, color]) => (
          <Card key={label} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>Min score: <strong style={{ color: "#e0e0f0" }}>{minScore}</strong></span>
          <input type="range" min="0" max="100" step="5" value={minScore} onChange={e => setMinScore(parseInt(e.target.value))}
            style={{ width: 100, accentColor: "#C8442F", cursor: "pointer" }} />
        </div>

        {[
          { label: "Classification", value: filterClass, onChange: setFilterClass, options: ["CREATE", "INVESTIGATE", "PASS"] },
          { label: "JOIN / CREATE", value: filterJoinCreate, onChange: setFilterJoinCreate, options: ["JOIN", "CREATE"] },
          { label: "Category", value: filterCategory, onChange: setFilterCategory, options: SOURCE_CATEGORIES },
          { label: "Urgency", value: filterUrgency, onChange: setFilterUrgency, options: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
        ].map(({ label, value, onChange, options }) => (
          <select key={label} value={value} onChange={e => onChange(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, cursor: "pointer" }}>
            <option value="">{label}: All</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}

        <select value={filterCaseType} onChange={e => setFilterCaseType(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0f0", fontSize: 12, cursor: "pointer" }}>
          <option value="">Case Type: All</option>
          {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <Btn small variant="secondary" onClick={fetchLeads}>Refresh</Btn>
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
        {visibleLeads.length} leads · click any card to expand full intelligence report
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
          <div style={{ fontSize: 13 }}>Loading leads...</div>
        </div>
      ) : visibleLeads.length === 0 ? (
        <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📥</div>
          <div style={{ marginBottom: 8 }}>No leads yet.</div>
          <div style={{ fontSize: 12, color: "#444" }}>
            {error ? "Check Vercel deployment and KV configuration." : "Click \"Run Scan Now\" to monitor 50+ sources: FDA, CPSC, NHTSA, SEC, DOJ, EEOC, courts, Reddit, news, social media, PubMed, CFPB."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {visibleLeads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onDismiss={dismissLead} onAddToTracker={addToTracker} />
          ))}
        </div>
      )}
    </div>
  );
}
