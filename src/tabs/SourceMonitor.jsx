import { useState, useEffect } from "react";
import { Card, Badge, Btn } from "../components/UI.jsx";
import { SOURCES } from "../data/sources.js";

// Map rollup status string to dot color
function statusDot(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "ok" || s === "up")       return "#22c55e";
  if (s === "degraded" || s === "warn") return "#f59e0b";
  if (s === "down" || s === "error")  return "#ef4444";
  return null;
}

function timeAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SourceMonitor() {
  const [sourceFilter, setSourceFilter] = useState("");
  const [liveStatus, setLiveStatus] = useState({}); // keyed by source name (lowercased)

  useEffect(() => {
    fetch("/api/agents?rollup=source-monitor")
      .then(r => r.json())
      .then(d => {
        const entries = d?.rollup?.sources || d?.sources || [];
        if (!Array.isArray(entries)) return;
        const map = {};
        for (const entry of entries) {
          const key = (entry.name || entry.id || "").toLowerCase();
          if (key) map[key] = entry;
        }
        setLiveStatus(map);
      })
      .catch(() => {}); // graceful fallback — static cards shown as-is
  }, []);

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
        {filteredSources.map(s => {
          const live = liveStatus[s.name.toLowerCase()] || liveStatus[(s.id || "").toLowerCase()];
          const dot = live ? statusDot(live.status) : null;
          return (
            <Card key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    {dot && (
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, boxShadow: `0 0 5px ${dot}` }} />
                    )}
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#888" }}>{s.type}</div>
                  {live && (
                    <div style={{ fontSize: 10, color: "var(--text-6)", marginTop: 3 }}>
                      {live.lastRun ? `Last run: ${timeAgo(live.lastRun)}` : null}
                      {live.itemsCollected != null ? ` · ${live.itemsCollected} items` : null}
                    </div>
                  )}
                </div>
                <Badge label={s.category} color={
                  s.category === "Federal" ? "#3b82f6" : s.category === "Medical" ? "#ef4444" : s.category === "Judicial" ? "#f59e0b" : s.category === "News" ? "#22c55e" : s.category === "Plaintiff Intel" ? "#B83E2C" : s.category === "State" ? "#ec4899" : "#6b7280"
                } />
              </div>
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", wordBreak: "break-all", textDecoration: "none" }}>
                {s.url.replace("https://", "").substring(0, 50)}...
              </a>
              <div style={{ marginTop: 10 }}>
                <Btn small variant="secondary" onClick={() => window.open(s.url, "_blank")}>Open Source ↗</Btn>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
