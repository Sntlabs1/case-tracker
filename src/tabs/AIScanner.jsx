import { useState } from "react";
import { Card, Btn } from "../components/UI.jsx";

export default function AIScanner({ onAddCase }) {
  const [webResults, setWebResults] = useState([]);
  const [webLoading, setWebLoading] = useState(false);
  const [webQuery, setWebQuery] = useState("");

  const searchRecalls = async () => {
    setWebLoading(true);
    setWebResults([]);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Search for the latest product recalls, FDA recalls, class action lawsuits, and MDL litigation developments from the past 30 days. Focus on: ${webQuery || "all recent recalls and class actions"}. Return a summary of the top findings with case names, companies involved, affected populations, and current status. Format as a structured list.`,
          maxTokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      const data = await r.json();
      const text = data.error ? `Error: ${data.error}` : (data.text || "No results found.");
      setWebResults([{ text }]);
    } catch (e) {
      setWebResults([{ text: "Error: " + e.message }]);
    }
    setWebLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>AI Recall & Litigation Scanner</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>Use AI with web search to discover the latest recalls, class actions, and MDL developments.</p>
      <Card>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <input value={webQuery} onChange={e => setWebQuery(e.target.value)} placeholder="e.g., medical device recalls 2025, PFAS litigation updates, recent FDA warning letters..." style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "var(--text-1)", fontSize: 13, outline: "none" }} />
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
              <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>{r.text}</div>
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
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#F07868" }}>Quick Add from Scan</h3>
          <p style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>Found something promising? Add it to your case tracker.</p>
          <Btn onClick={onAddCase}>+ Add New Case from Scan Results</Btn>
        </Card>
      </div>
    </div>
  );
}
