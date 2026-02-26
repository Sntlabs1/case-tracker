import { useState } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";
import { SOURCES } from "../data/sources.js";

export default function SourceMonitor() {
  const [sourceFilter, setSourceFilter] = useState("");

  const sourceCategories = [...new Set(SOURCES.map(s => s.category))];
  const filteredSources = sourceFilter ? SOURCES.filter(s => s.category === sourceFilter) : SOURCES;

  return (
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
                s.category === "Federal" ? "#3b82f6" : s.category === "Medical" ? "#ef4444" : s.category === "Judicial" ? "#f59e0b" : s.category === "News" ? "#22c55e" : s.category === "Plaintiff Intel" ? "#B83E2C" : s.category === "State" ? "#ec4899" : "#6b7280"
              } />
            </div>
            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#C8442F", wordBreak: "break-all", textDecoration: "none" }}>
              {s.url.replace("https://", "").substring(0, 50)}...
            </a>
            <div style={{ marginTop: 10 }}>
              <Btn small variant="secondary" onClick={() => window.open(s.url, "_blank")}>Open Source ↗</Btn>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
