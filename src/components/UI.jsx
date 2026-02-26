export const Card = ({ children, className = "", onClick, style = {} }) => (
  <div onClick={onClick} className={className} style={{ background: "#131418", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", padding: 20, ...(onClick ? { cursor: "pointer" } : {}), ...style }}>{children}</div>
);

export const Badge = ({ label, color }) => (
  <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: color + "22", color, border: `1px solid ${color}44` }}>{label}</span>
);

export const Btn = ({ children, onClick, variant = "primary", small, style = {} }) => {
  const base = { border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: small ? 12 : 13, padding: small ? "5px 12px" : "8px 18px", transition: "all 0.2s" };
  const styles = {
    primary: { ...base, background: "#C8442F", color: "#fff" },
    secondary: { ...base, background: "rgba(255,255,255,0.07)", color: "#c0c0d0", border: "1px solid rgba(255,255,255,0.10)" },
    danger: { ...base, background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" },
    success: { ...base, background: "#22c55e20", color: "#4ade80", border: "1px solid #22c55e40" },
  };
  return <button onClick={onClick} style={{ ...styles[variant], ...style }}>{children}</button>;
};

export const Input = ({ label, value, onChange, type = "text", placeholder, style = {} }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.10)", background: "#0d0e18", color: "#e0e0f0", fontSize: 13, outline: "none", boxSizing: "border-box", ...style }} />
  </div>
);

export const Select = ({ label, value, onChange, options, style = {} }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.10)", background: "#0d0e18", color: "#e0e0f0", fontSize: 13, outline: "none", boxSizing: "border-box", ...style }}>
      <option value="">All</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

export const TextArea = ({ label, value, onChange, rows = 3, placeholder }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 12, color: "#a0a0b8", marginBottom: 4, fontWeight: 500 }}>{label}</label>}
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.10)", background: "#0d0e18", color: "#e0e0f0", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
  </div>
);

export const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#131418", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: 28, maxWidth: 600, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#e0e0f0", fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const ScoreBar = ({ score }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", borderRadius: 3, background: score >= 80 ? "linear-gradient(90deg,#22c55e,#4ade80)" : score >= 60 ? "linear-gradient(90deg,#eab308,#facc15)" : "linear-gradient(90deg,#ef4444,#f87171)", transition: "width 0.5s" }} />
    </div>
    <span style={{ fontSize: 12, fontWeight: 700, color: score >= 80 ? "#4ade80" : score >= 60 ? "#facc15" : "#f87171", minWidth: 28 }}>{score}</span>
  </div>
);

export const Rule23Badges = ({ numerosity, commonality, typicality, adequacy }) => (
  <div style={{ display: "flex", gap: 3 }}>
    {[["N", numerosity, "Numerosity"], ["C", commonality, "Commonality"], ["T", typicality, "Typicality"], ["A", adequacy, "Adequacy"]].map(([label, val, title]) => (
      <span key={label} title={title} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: val ? "#22c55e22" : "#ef444422", color: val ? "#4ade80" : "#f87171", border: `1px solid ${val ? "#22c55e44" : "#ef444444"}` }}>{label}</span>
    ))}
  </div>
);

export const AIPanel = ({ caseData, onClose, apiKey }) => {
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
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompts[mode] }] })
      });
      const data = await r.json();
      setAnalysis(data.content?.map(b => b.text || "").join("\n") || "No response received.");
    } catch (e) { setAnalysis("Error: " + e.message); }
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

// Need useState for AIPanel
import { useState } from "react";
