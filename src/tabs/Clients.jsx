import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, Btn } from "../components/UI.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function scoreColor(s) {
  return s >= 75 ? "#22c55e" : s >= 50 ? "#f59e0b" : s >= 30 ? "#fb923c" : "#ef4444";
}

// ── Simple CSV parser (handles quoted fields, comma + tab + semicolon) ────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect delimiter
  const firstLine = lines[0];
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  function parseLine(line) {
    const fields = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === delim && !inQ) {
        fields.push(cur.trim()); cur = "";
      } else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, "_"));
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v));

  return { headers, rows };
}

// Flexible column mapping — tries to auto-detect common header names
function autoMap(headers) {
  const find = (...terms) => headers.find(h => terms.some(t => h.includes(t))) || "";
  return {
    firstName:        find("first_name", "firstname", "first"),
    lastName:         find("last_name", "lastname", "last"),
    email:            find("email"),
    phone:            find("phone", "mobile", "cell"),
    state:            find("state"),
    city:             find("city"),
    dob:              find("dob", "birth", "birthdate", "date_of_birth"),
    age:              find("age"),
    injuries:         find("injur", "condition", "diagnosis", "medical", "harm"),
    productsUsed:     find("product", "device", "item"),
    medicationsUsed:  find("medication", "drug", "medicine", "rx", "prescription"),
    exposurePeriod:   find("exposure", "period", "exposure_date", "dates"),
    occupation:       find("occupation", "job", "employer", "employment", "work"),
    caseNotes:        find("notes", "comment", "description", "detail", "memo"),
    originalCaseType: find("case_type", "casetype", "type_of_case", "matter"),
    existingCases:    find("existing", "prior", "previous", "history"),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({ label, value, color = "#C8442F" }) {
  return (
    <div style={{ padding: "14px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function ClientRow({ client, onSelect, onDelete, selected }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", gap: 12, alignItems: "center", padding: "10px 14px",
        borderRadius: 8, cursor: "pointer", transition: "all 0.13s",
        background: selected ? "rgba(200,68,47,0.08)" : hov ? "var(--bg-surface)" : "transparent",
        border: `1px solid ${selected ? "rgba(200,68,47,0.3)" : hov ? "var(--border-hov)" : "var(--border)"}`,
        marginBottom: 4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }} onClick={onSelect}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {client.firstName} {client.lastName}
          </span>
          {client.state && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(100,120,220,0.12)", color: "#8090d0", border: "1px solid rgba(100,120,220,0.2)" }}>
              {client.state}
            </span>
          )}
          {client.age && <span style={{ fontSize: 10, color: "var(--text-5)" }}>age {client.age}</span>}
          {client.matchedLeads?.length > 0 && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
              {client.matchedLeads.length} match{client.matchedLeads.length > 1 ? "es" : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {client.injuries && (
            <span style={{ fontSize: 11, color: "var(--text-5)" }}>Injuries: {client.injuries.slice(0, 60)}</span>
          )}
          {client.medicationsUsed && (
            <span style={{ fontSize: 11, color: "var(--text-6)" }}>Rx: {client.medicationsUsed.slice(0, 40)}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-7)", marginTop: 2 }}>{client.sourceFirm}</div>
      </div>
      {hov && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(client.id); }}
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#ef4444", cursor: "pointer", flexShrink: 0 }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function MatchResult({ match, rank }) {
  const [hov, setHov] = useState(false);
  const [exp, setExp] = useState(false);
  const sc = scoreColor(match.score || 0);
  const c = match.client || {};

  return (
    <div
      onClick={() => setExp(x => !x)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "12px 14px", borderRadius: 8, marginBottom: 6,
        background: hov ? "var(--bg-surface)" : "var(--bg-surface2)",
        border: `1px solid ${hov ? "var(--border-hov)" : "var(--border)"}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 46, flexShrink: 0, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "var(--text-7)", fontWeight: 700 }}>#{rank}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: sc, lineHeight: 1.1 }}>{match.score}</div>
          {match.qualifies && <div style={{ fontSize: 9, fontWeight: 700, color: "#22c55e" }}>QUALIFIES</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>
            {c.firstName} {c.lastName}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 3 }}>{match.reason}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {c.state && <span style={{ fontSize: 10, color: "var(--text-6)" }}>{c.state}</span>}
            {c.age && <span style={{ fontSize: 10, color: "var(--text-6)" }}>age {c.age}</span>}
            <span style={{ fontSize: 10, color: "var(--text-7)" }}>{c.sourceFirm}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-6)", flexShrink: 0 }}>{exp ? "▲" : "▼"}</div>
      </div>

      {exp && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {c.injuries && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Injuries</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.injuries}</div></div>}
            {c.medicationsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Medications</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.medicationsUsed}</div></div>}
            {c.productsUsed && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Products</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.productsUsed}</div></div>}
            {c.exposurePeriod && <div><div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>Exposure Period</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.exposurePeriod}</div></div>}
          </div>
          {match.matchingFactors?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Qualifying Factors</div>
              {match.matchingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>+ {f}</div>)}
            </div>
          )}
          {match.disqualifyingFactors?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 9, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Disqualifying Factors</div>
              {match.disqualifyingFactors.map((f, i) => <div key={i} style={{ fontSize: 11, color: "#f87171" }}>− {f}</div>)}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: "#C8442F", textDecoration: "none" }}>{c.email}</a>}
            {c.phone && <span style={{ fontSize: 11, color: "var(--text-5)" }}>{c.phone}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Import Wizard ─────────────────────────────────────────────────────────────
function ImportWizard({ onImported }) {
  const [step, setStep] = useState("upload"); // upload → map → confirm → done
  const [firmName, setFirmName] = useState("");
  const [parsed, setParsed] = useState(null);     // { headers, rows }
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const fileRef = useRef(null);

  // Manual entry state
  const [manual, setManual] = useState({ firstName: "", lastName: "", email: "", phone: "", state: "", age: "", injuries: "", medicationsUsed: "", productsUsed: "", exposurePeriod: "", occupation: "", caseNotes: "", originalCaseType: "" });

  const FIELD_LABELS = {
    firstName: "First Name *", lastName: "Last Name *", email: "Email", phone: "Phone",
    state: "State (2-letter)", age: "Age", dob: "Date of Birth",
    injuries: "Injuries / Conditions", medicationsUsed: "Medications / Drugs",
    productsUsed: "Products / Devices", exposurePeriod: "Exposure Period",
    occupation: "Occupation", caseNotes: "Case Notes / Comments",
    originalCaseType: "Original Case Type", existingCases: "Prior Cases",
  };

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const { headers, rows } = parseCSV(e.target.result);
      const map = autoMap(headers);
      setParsed({ headers, rows });
      setMapping(map);
      setStep("map");
    };
    reader.readAsText(file);
  }

  function buildClients(rows, map) {
    return rows.map(row => {
      const get = field => map[field] ? row[map[field]] || "" : "";
      return {
        firstName: get("firstName"), lastName: get("lastName"),
        email: get("email"), phone: get("phone"), state: get("state"),
        age: get("age"), dob: get("dob"),
        injuries: get("injuries"), medicationsUsed: get("medicationsUsed"),
        productsUsed: get("productsUsed"), exposurePeriod: get("exposurePeriod"),
        occupation: get("occupation"), caseNotes: get("caseNotes"),
        originalCaseType: get("originalCaseType"), existingCases: get("existingCases"),
        sourceFirm: firmName || "Imported Firm",
      };
    }).filter(c => c.firstName || c.lastName);
  }

  async function doImport(clients) {
    setImporting(true);
    // Send in batches of 500
    let imported = 0;
    const BATCH_SIZE = 500;
    for (let i = 0; i < clients.length; i += BATCH_SIZE) {
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: clients.slice(i, i + BATCH_SIZE) }),
      });
      const d = await r.json();
      imported += d.imported || 0;
    }
    setResult(imported);
    setImporting(false);
    setStep("done");
    onImported(imported);
  }

  if (step === "done") return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 48, fontWeight: 800, color: "#22c55e", lineHeight: 1, marginBottom: 8 }}>{result}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Clients Imported</div>
      <div style={{ fontSize: 13, color: "var(--text-5)", marginBottom: 24 }}>from {firmName || "imported firm"}</div>
      <Btn onClick={() => { setStep("upload"); setParsed(null); setFirmName(""); setResult(null); }}>Import Another Firm</Btn>
    </div>
  );

  return (
    <div>
      {/* Firm name — always shown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 6, fontWeight: 600 }}>ACQUIRED FIRM NAME</div>
        <input
          value={firmName}
          onChange={e => setFirmName(e.target.value)}
          placeholder="e.g. Johnson & Associates Law Firm"
          style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", color: "var(--text-1)", fontSize: 13, outline: "none" }}
        />
      </div>

      {/* Toggle manual vs CSV */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button onClick={() => setManualMode(false)} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: !manualMode ? "#C8442F" : "var(--bg-surface)", color: !manualMode ? "#fff" : "var(--text-4)", border: `1px solid ${!manualMode ? "#C8442F" : "var(--border)"}` }}>
          CSV / Spreadsheet Import
        </button>
        <button onClick={() => setManualMode(true)} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: manualMode ? "#C8442F" : "var(--bg-surface)", color: manualMode ? "#fff" : "var(--text-4)", border: `1px solid ${manualMode ? "#C8442F" : "var(--border)"}` }}>
          Add Single Client
        </button>
      </div>

      {/* MANUAL ENTRY */}
      {manualMode && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field} style={{ gridColumn: ["caseNotes", "injuries"].includes(field) ? "1 / -1" : undefined }}>
                <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
                {["caseNotes", "injuries"].includes(field) ? (
                  <textarea value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))} rows={2}
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none", resize: "vertical" }} />
                ) : field === "state" ? (
                  <select value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))}
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                    <option value="">— Select —</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={manual[field] || ""} onChange={e => setManual(m => ({ ...m, [field]: e.target.value }))} placeholder=""
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
                )}
              </div>
            ))}
          </div>
          <Btn onClick={() => doImport([{ ...manual, sourceFirm: firmName || "Manual Entry" }])} disabled={importing || !manual.firstName}>
            {importing ? "Saving…" : "Add Client"}
          </Btn>
        </div>
      )}

      {/* CSV UPLOAD */}
      {!manualMode && step === "upload" && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          style={{
            border: "2px dashed var(--border-md)", borderRadius: 12, padding: "48px 24px",
            textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Drop CSV or spreadsheet here</div>
          <div style={{ fontSize: 12, color: "var(--text-5)" }}>Supports CSV, TSV, or semicolon-delimited exports from Clio, MyCase, PracticePanther, Filevine, or any spreadsheet</div>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>
      )}

      {/* COLUMN MAPPING */}
      {!manualMode && step === "map" && parsed && (
        <div>
          <div style={{ marginBottom: 14, fontSize: 13, color: "var(--text-2)" }}>
            Detected <strong style={{ color: "var(--text-1)" }}>{parsed.rows.length} rows</strong>. Map your columns to client fields:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field}>
                <div style={{ fontSize: 10, color: "var(--text-5)", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
                <select
                  value={mapping[field] || ""}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                  style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}
                >
                  <option value="">— Skip —</option>
                  {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Preview first 3 rows */}
          <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-6)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Preview (first 3 rows)</div>
            {buildClients(parsed.rows.slice(0, 3), mapping).map((c, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                {c.firstName} {c.lastName} | {c.state} | {c.injuries?.slice(0, 40)} | {c.medicationsUsed?.slice(0, 40)}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => { const clients = buildClients(parsed.rows, mapping); doImport(clients); }} disabled={importing}>
              {importing ? `Importing…` : `Import ${parsed.rows.length} Clients →`}
            </Btn>
            <Btn variant="secondary" onClick={() => { setParsed(null); setStep("upload"); }}>Back</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lead picker for match runner ───────────────────────────────────────────────
function LeadPicker({ onPick }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/leads?limit=200&minScore=50")
      .then(r => r.json())
      .then(d => { setLeads(d.leads || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!q) return leads;
    const ql = q.toLowerCase();
    return leads.filter(l => {
      const a = l.analysis || {};
      return `${a.headline || l.title} ${a.caseType} ${a.defendantProfile?.name}`.toLowerCase().includes(ql);
    });
  }, [leads, q]);

  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search leads…"
        style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text-1)", fontSize: 13, outline: "none", marginBottom: 10 }} />
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-5)", padding: "16px 0" }}>Loading leads…</div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {filtered.slice(0, 60).map(lead => {
            const a = lead.analysis || {};
            return (
              <div key={lead.id} onClick={() => onPick(lead)}
                style={{ padding: "10px 12px", borderRadius: 7, cursor: "pointer", background: "var(--bg-surface2)", border: "1px solid var(--border)", transition: "all 0.12s" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-surface)"}
                onMouseLeave={e => e.currentTarget.style.background = "var(--bg-surface2)"}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", lineHeight: 1, width: 32, flexShrink: 0 }}>{a.score || 0}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.headline || lead.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                      {a.caseType}{a.defendantProfile?.name && a.defendantProfile.name !== "Unknown" ? ` · vs. ${a.defendantProfile.name}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ fontSize: 12, color: "var(--text-6)", padding: "16px 0", textAlign: "center" }}>No leads match</div>}
        </div>
      )}
    </div>
  );
}

// ── Main Clients tab ───────────────────────────────────────────────────────────
export default function Clients() {
  const [view, setView] = useState("database"); // database | import | match
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [firms, setFirms] = useState([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [importCount, setImportCount] = useState(0);

  // Match state
  const [matchView, setMatchView] = useState("pick"); // pick | running | results
  const [matchLead, setMatchLead] = useState(null);
  const [matchFirmFilter, setMatchFirmFilter] = useState("");
  const [matchResults, setMatchResults] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);

  const fetchClients = useCallback((params = "") => {
    setLoading(true);
    fetch(`/api/clients${params}`)
      .then(r => r.json())
      .then(d => { setClients(d.clients || []); setFirms(d.firms || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients, importCount]);

  // Apply filters
  const filtered = useMemo(() => {
    let out = clients;
    if (firmFilter) out = out.filter(c => c.sourceFirm === firmFilter);
    if (stateFilter) out = out.filter(c => c.state === stateFilter);
    if (searchQ) {
      const ql = searchQ.toLowerCase();
      out = out.filter(c => `${c.firstName} ${c.lastName} ${c.injuries} ${c.medicationsUsed} ${c.productsUsed}`.toLowerCase().includes(ql));
    }
    return out;
  }, [clients, firmFilter, stateFilter, searchQ]);

  async function deleteClient(id) {
    await fetch(`/api/clients?id=${id}`, { method: "DELETE" });
    setClients(cs => cs.filter(c => c.id !== id));
    if (selectedClient?.id === id) setSelectedClient(null);
  }

  async function runMatch() {
    if (!matchLead) return;
    setMatchLoading(true);
    setMatchView("running");
    try {
      const r = await fetch("/api/match-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: matchLead.id, firmFilter: matchFirmFilter || undefined }),
      });
      const d = await r.json();
      setMatchResults(d);
      setMatchView("results");
    } catch (e) {
      alert("Match error: " + e.message);
      setMatchView("pick");
    }
    setMatchLoading(false);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalWithMatches = clients.filter(c => c.matchedLeads?.length > 0).length;
  const statesRepresented = [...new Set(clients.map(c => c.state).filter(Boolean))].length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatPill label="Total Clients" value={clients.length} color="#C8442F" />
        <StatPill label="Firms Imported" value={firms.length} color="#3b82f6" />
        <StatPill label="States Represented" value={statesRepresented} color="#f59e0b" />
        <StatPill label="With Case Matches" value={totalWithMatches || "—"} color="#22c55e" />
      </div>

      {/* ── View selector ── */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {[
          { id: "database", label: `Client Database (${clients.length})` },
          { id: "import",   label: "Import Clients" },
          { id: "match",    label: "Match to Cases" },
        ].map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            padding: "9px 18px", border: "none", background: "transparent",
            borderBottom: view === v.id ? "2px solid #C8442F" : "2px solid transparent",
            color: view === v.id ? "var(--text-1)" : "var(--text-5)",
            fontWeight: view === v.id ? 700 : 400, fontSize: 13, cursor: "pointer", marginBottom: -1,
          }}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── DATABASE VIEW ── */}
      {view === "database" && (
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>
          {/* Left: list */}
          <Card>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search name, injury, medication…"
                style={{ flex: 1, minWidth: 180, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", color: "var(--text-1)", fontSize: 12, outline: "none" }} />
              <select value={firmFilter} onChange={e => setFirmFilter(e.target.value)}
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none", minWidth: 160 }}>
                <option value="">All Firms</option>
                {firms.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                <option value="">All States</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-6)", marginBottom: 10 }}>
              Showing {filtered.length} of {clients.length} clients
              {(firmFilter || stateFilter || searchQ) && (
                <button onClick={() => { setFirmFilter(""); setStateFilter(""); setSearchQ(""); }}
                  style={{ marginLeft: 8, fontSize: 10, color: "#C8442F", background: "none", border: "none", cursor: "pointer" }}>
                  Clear filters
                </button>
              )}
            </div>
            {loading ? (
              <div style={{ fontSize: 12, color: "var(--text-5)", textAlign: "center", padding: "32px 0" }}>Loading clients…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 13, color: "var(--text-5)", marginBottom: 12 }}>
                  {clients.length === 0 ? "No clients imported yet." : "No clients match your filters."}
                </div>
                {clients.length === 0 && <Btn onClick={() => setView("import")}>Import Clients →</Btn>}
              </div>
            ) : (
              <div style={{ maxHeight: 600, overflowY: "auto" }}>
                {filtered.map(c => (
                  <ClientRow
                    key={c.id}
                    client={c}
                    selected={selectedClient?.id === c.id}
                    onSelect={() => setSelectedClient(c)}
                    onDelete={deleteClient}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Right: client detail */}
          <Card>
            {!selectedClient ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-6)", fontSize: 12 }}>
                Click a client to view their full profile
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-1)" }}>
                      {selectedClient.firstName} {selectedClient.lastName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-5)", marginTop: 2 }}>{selectedClient.sourceFirm}</div>
                  </div>
                  <button onClick={() => setSelectedClient(null)} style={{ background: "none", border: "none", color: "var(--text-5)", cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    ["State", selectedClient.state],
                    ["Age", selectedClient.age],
                    ["DOB", selectedClient.dob],
                    ["Occupation", selectedClient.occupation],
                    ["Original Case", selectedClient.originalCaseType],
                    ["Email", selectedClient.email],
                    ["Phone", selectedClient.phone],
                  ].map(([l, v]) => v ? (
                    <div key={l}>
                      <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{v}</div>
                    </div>
                  ) : null)}
                </div>

                {selectedClient.injuries && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Injuries / Conditions</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.injuries}</div>
                  </div>
                )}
                {selectedClient.medicationsUsed && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Medications</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.medicationsUsed}</div>
                  </div>
                )}
                {selectedClient.productsUsed && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Products / Devices</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{selectedClient.productsUsed}</div>
                  </div>
                )}
                {selectedClient.caseNotes && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, color: "var(--text-7)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Case Notes</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 6 }}>{selectedClient.caseNotes}</div>
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <Btn small onClick={() => {
                    setMatchLead(null);
                    setMatchView("pick");
                    setView("match");
                  }}>
                    Find Matching Cases →
                  </Btn>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── IMPORT VIEW ── */}
      {view === "import" && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Import Client Data</div>
          <div style={{ fontSize: 12, color: "var(--text-5)", marginBottom: 20 }}>
            Import client lists from acquired firms. Supports CSV exports from Clio, MyCase, PracticePanther, Filevine, or any spreadsheet.
            All client data is stored securely in your database and used only for matching.
          </div>
          <ImportWizard onImported={count => { setImportCount(x => x + count); setView("database"); }} />
        </Card>
      )}

      {/* ── MATCH VIEW ── */}
      {view === "match" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16 }}>
          {/* Left panel */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Run Client Match</div>
            <div style={{ fontSize: 11, color: "var(--text-5)", marginBottom: 16 }}>
              Select a case lead, then Claude will score every client in your database against its plaintiff requirements.
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Filter by Firm (optional)</div>
              <select value={matchFirmFilter} onChange={e => setMatchFirmFilter(e.target.value)}
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-1)", fontSize: 12, outline: "none" }}>
                <option value="">All Firms ({clients.length} clients)</option>
                {firms.map(f => {
                  const n = clients.filter(c => c.sourceFirm === f).length;
                  return <option key={f} value={f}>{f} ({n})</option>;
                })}
              </select>
            </div>

            {matchLead ? (
              <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(200,68,47,0.08)", borderRadius: 8, border: "1px solid rgba(200,68,47,0.25)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#C8442F", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Selected Lead</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>{matchLead.analysis?.headline || matchLead.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                  {matchLead.analysis?.caseType} · Score {matchLead.analysis?.score}
                </div>
                <button onClick={() => { setMatchLead(null); setMatchView("pick"); }}
                  style={{ marginTop: 8, fontSize: 10, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>
                  Change lead ×
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-5)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Select a Lead</div>
                <LeadPicker onPick={lead => { setMatchLead(lead); setMatchView("ready"); }} />
              </div>
            )}

            {matchLead && matchView !== "running" && (
              <Btn onClick={runMatch} disabled={matchLoading}>
                {matchLoading ? "Matching…" : `Match ${matchFirmFilter ? clients.filter(c => c.sourceFirm === matchFirmFilter).length : clients.length} Clients →`}
              </Btn>
            )}

            {matchView === "running" && (
              <div style={{ padding: "20px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 6 }}>Analyzing clients with AI…</div>
                <div style={{ fontSize: 11, color: "var(--text-6)" }}>This may take 30–60 seconds for large databases</div>
              </div>
            )}
          </Card>

          {/* Right panel — results */}
          <Card>
            {!matchResults ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⚖️</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Select a case lead to start matching</div>
                <div style={{ fontSize: 12, color: "var(--text-5)" }}>
                  Claude will screen every client in your database against the plaintiff requirements for the selected case
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginBottom: 3 }}>Match Results</div>
                    <div style={{ fontSize: 11, color: "var(--text-5)" }}>
                      <span style={{ color: "#22c55e", fontWeight: 700 }}>{matchResults.qualifying}</span> qualifying out of{" "}
                      <span style={{ fontWeight: 600 }}>{matchResults.total}</span> clients scanned
                    </div>
                  </div>
                  <button onClick={() => { setMatchResults(null); setMatchLead(null); setMatchView("pick"); }}
                    style={{ fontSize: 11, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer" }}>
                    New search
                  </button>
                </div>

                <div style={{ padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 14, fontSize: 11, color: "var(--text-4)" }}>
                  Case: <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{matchResults.leadTitle}</span>
                </div>

                {/* Score distribution */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "Strong (75+)", count: matchResults.matches.filter(m => m.score >= 75).length, color: "#22c55e" },
                    { label: "Good (50–74)", count: matchResults.matches.filter(m => m.score >= 50 && m.score < 75).length, color: "#f59e0b" },
                    { label: "Weak (25–49)", count: matchResults.matches.filter(m => m.score >= 25 && m.score < 50).length, color: "#fb923c" },
                    { label: "No Match (<25)", count: matchResults.matches.filter(m => m.score < 25).length, color: "#ef4444" },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ textAlign: "center", padding: "8px 6px", background: "var(--bg-surface2)", borderRadius: 7, border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                      <div style={{ fontSize: 9, color: "var(--text-6)", marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ maxHeight: 500, overflowY: "auto" }}>
                  {matchResults.matches.map((m, i) => (
                    <MatchResult key={m.id || i} match={m} rank={i + 1} />
                  ))}
                  {matchResults.matches.length === 0 && (
                    <div style={{ textAlign: "center", padding: "32px 0", fontSize: 12, color: "var(--text-6)" }}>
                      No clients matched this case's plaintiff requirements.
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
