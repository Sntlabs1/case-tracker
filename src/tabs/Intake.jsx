import { useState, useRef } from "react";
import { Card, Btn } from "../components/UI.jsx";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
  WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

function scoreColor(s) {
  if (s >= 75) return "#22c55e";
  if (s >= 50) return "#f59e0b";
  if (s >= 30) return "#fb923c";
  return "#ef4444";
}

function ScoreBadge({ score }) {
  const color = scoreColor(score);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 44, height: 44, borderRadius: "50%",
      background: color + "22", border: `2px solid ${color}55`,
      color, fontWeight: 800, fontSize: 15, flexShrink: 0,
    }}>
      {score}
    </span>
  );
}

function QualifyBadge({ qualifies }) {
  const color = qualifies ? "#22c55e" : "#6b7280";
  const label = qualifies ? "Qualifies" : "Does Not Qualify";
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 700,
      background: color + "22", color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function IntakeScriptBlock({ questions }) {
  const [open, setOpen] = useState(false);
  if (!questions || !questions.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#C8442F", fontSize: 12, fontWeight: 600, padding: 0,
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        {open ? "Hide" : "Show"} Intake Script ({questions.length} questions)
      </button>
      {open && (
        <div style={{
          marginTop: 8, padding: "12px 14px",
          background: "var(--bg-surface2)", borderRadius: 8,
          border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 11, color: "var(--text-4)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Ask the caller:
          </div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {questions.map((q, i) => (
              <li key={i} style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 6, lineHeight: 1.5 }}>
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, callerData, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const clientPayload = {
        client: {
          firstName:        callerData.name ? callerData.name.split(" ")[0] : "",
          lastName:         callerData.name ? callerData.name.split(" ").slice(1).join(" ") : "",
          state:            callerData.state || "",
          age:              callerData.age || "",
          injuries:         callerData.injuries || "",
          medicationsUsed:  callerData.medications || "",
          productsUsed:     callerData.products || "",
          occupation:       callerData.occupation || "",
          caseNotes:        [
            callerData.notes ? `Notes: ${callerData.notes}` : "",
            `Matched via Intake Screen — Lead: ${match.leadTitle} (score ${match.score})`,
            match.reason ? `Match reason: ${match.reason}` : "",
          ].filter(Boolean).join("\n"),
          sourceFirm:       "Intake Screen",
          originalCaseType: match.caseType || "",
          existingCases:    match.leadId ? `lead:${match.leadId}` : "",
          importedAt:       new Date().toISOString(),
        },
      };

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientPayload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setSaved(true);
      if (onSaved) onSaved(match.leadId);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <ScoreBadge score={match.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-1)" }}>
              {match.leadTitle}
            </span>
            <QualifyBadge qualifies={match.qualifies} />
            {match.caseType && (
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 999,
                background: "var(--bg-surface)", color: "var(--text-4)",
                border: "1px solid var(--border)",
              }}>
                {match.caseType}
              </span>
            )}
          </div>

          {match.reason && (
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
              {match.reason}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
            {match.estimatedFee && (
              <span style={{ fontSize: 12, color: "var(--text-4)" }}>
                <span style={{ color: "var(--text-5)" }}>Est. fee: </span>
                {match.estimatedFee}
              </span>
            )}
            {match.requiredInjury && (
              <span style={{ fontSize: 12, color: "var(--text-4)" }}>
                <span style={{ color: "var(--text-5)" }}>Required injury: </span>
                {match.requiredInjury}
              </span>
            )}
          </div>

          {match.urgencyNote && (
            <div style={{
              fontSize: 12, color: "#f59e0b", marginBottom: 8,
              padding: "4px 10px", background: "#f59e0b15", borderRadius: 6,
              border: "1px solid #f59e0b33", display: "inline-block",
            }}>
              {match.urgencyNote}
            </div>
          )}

          <IntakeScriptBlock questions={match.intakeScript} />

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            {!saved ? (
              <Btn
                onClick={handleSave}
                disabled={saving}
                small
                style={{ opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Saving..." : "Save as Client"}
              </Btn>
            ) : (
              <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>
                Saved to Clients
              </span>
            )}
            {saveError && (
              <span style={{ fontSize: 12, color: "#ef4444" }}>{saveError}</span>
            )}
            {match.url && (
              <a
                href={match.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "var(--text-5)", textDecoration: "none" }}
              >
                Source
              </a>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-input)",
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "var(--text-3)",
  fontWeight: 600,
  marginBottom: 5,
  letterSpacing: "0.03em",
};

const fieldStyle = { marginBottom: 14 };

export default function Intake() {
  const [form, setForm] = useState({
    name: "", state: "", age: "",
    injuries: "", medications: "", products: "",
    occupation: "", notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const resultsRef = useRef(null);

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit() {
    if (!form.injuries && !form.medications && !form.products) {
      setError("Please enter at least one injury, medication, or product.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);

    try {
      const res = await fetch("/api/intake-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setResults(data);
      // Scroll to results
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e) {
      setError(e.message || "Screening failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResults(null);
    setError("");
    setForm({ name: "", state: "", age: "", injuries: "", medications: "", products: "", occupation: "", notes: "" });
  }

  const qualifying = results?.matches?.filter(m => m.score >= 50) || [];
  const nonQualifying = results?.matches?.filter(m => m.score < 50) || [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 60px" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 800, color: "var(--text-1)" }}>
          Quick Intake Screener
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-4)", lineHeight: 1.6 }}>
          Enter caller information to instantly identify qualifying class actions
        </p>
      </div>

      {/* Form */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 28px" }}>

          {/* Left column */}
          <div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setField("name", e.target.value)}
                placeholder="e.g. Jane Smith"
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>State</label>
              <select
                value={form.state}
                onChange={e => setField("state", e.target.value)}
                style={inputStyle}
              >
                <option value="">-- Select state --</option>
                {US_STATES.map(s => (
                  <option key={s} value={s}>{s} — {STATE_NAMES[s]}</option>
                ))}
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Age</label>
              <input
                type="number"
                value={form.age}
                onChange={e => setField("age", e.target.value)}
                placeholder="e.g. 52"
                min={0}
                max={120}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Right column */}
          <div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Injuries / Conditions</label>
              <textarea
                value={form.injuries}
                onChange={e => setField("injuries", e.target.value)}
                rows={3}
                placeholder="e.g. gastroparesis, vision loss, back pain"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Medications / Drugs</label>
              <textarea
                value={form.medications}
                onChange={e => setField("medications", e.target.value)}
                rows={3}
                placeholder="e.g. Ozempic, Wegovy, Tylenol, Elmiron"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Products / Devices</label>
              <textarea
                value={form.products}
                onChange={e => setField("products", e.target.value)}
                rows={2}
                placeholder="e.g. CPAP machine, Roundup herbicide, NuvaRing"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        {/* Full-width fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 28px" }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Occupation <span style={{ color: "var(--text-6)", fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              value={form.occupation}
              onChange={e => setField("occupation", e.target.value)}
              placeholder="e.g. nurse, factory worker, truck driver"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Additional Notes <span style={{ color: "var(--text-6)", fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={form.notes}
              onChange={e => setField("notes", e.target.value)}
              rows={2}
              placeholder="Any other relevant details about the caller's situation"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </div>

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 8, marginBottom: 14,
            background: "#ef444415", border: "1px solid #ef444440",
            color: "#ef4444", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 4 }}>
          <Btn
            onClick={handleSubmit}
            disabled={loading}
            style={{ opacity: loading ? 0.65 : 1, fontSize: 14, padding: "10px 24px" }}
          >
            {loading ? "Screening..." : "Screen for Cases →"}
          </Btn>
          {loading && (
            <span style={{ fontSize: 13, color: "var(--text-5)" }}>
              Scoring against top leads — this takes about 15 seconds...
            </span>
          )}
        </div>
      </Card>

      {/* Results */}
      {results && (
        <div ref={resultsRef}>
          {/* Summary bar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 20, flexWrap: "wrap", gap: 10,
          }}>
            <div>
              <span style={{
                fontSize: 18, fontWeight: 700,
                color: qualifying.length > 0 ? "#22c55e" : "#ef4444",
              }}>
                {qualifying.length} qualifying {qualifying.length === 1 ? "case" : "cases"} found
              </span>
              {results.callerName && results.callerName !== "Anonymous" && (
                <span style={{ fontSize: 15, color: "var(--text-4)", marginLeft: 8 }}>
                  for {results.callerName}
                </span>
              )}
              <div style={{ fontSize: 12, color: "var(--text-6)", marginTop: 3 }}>
                {results.leadsScanned} leads screened
              </div>
            </div>
            <Btn onClick={handleReset} variant="secondary" small>
              Start New Screen
            </Btn>
          </div>

          {/* Qualifying matches */}
          {qualifying.length > 0 ? (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: "var(--text-5)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Qualifying Cases (score 50+)
              </div>
              {qualifying.map(match => (
                <MatchCard
                  key={match.leadId}
                  match={match}
                  callerData={form}
                />
              ))}
            </div>
          ) : (
            <Card style={{ marginBottom: 24, textAlign: "center", padding: "32px 20px" }}>
              <div style={{ fontSize: 15, color: "var(--text-4)", marginBottom: 8 }}>
                No qualifying cases found for this caller profile.
              </div>
              <div style={{ fontSize: 13, color: "var(--text-6)" }}>
                Consider broadening the injury or medication information, or checking back as new leads are added hourly.
              </div>
            </Card>
          )}

          {/* Non-qualifying summary */}
          {nonQualifying.length > 0 && (
            <NonQualifyingAccordion count={nonQualifying.length} matches={nonQualifying} />
          )}
        </div>
      )}
    </div>
  );
}

function NonQualifyingAccordion({ count, matches }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-5)", fontSize: 13, padding: "8px 0",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        {count} {count === 1 ? "case" : "cases"} did not qualify — click to view
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {matches.map(match => (
            <Card key={match.leadId} style={{ marginBottom: 8, opacity: 0.7 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: "50%",
                  background: scoreColor(match.score) + "22",
                  border: `2px solid ${scoreColor(match.score)}44`,
                  color: scoreColor(match.score),
                  fontWeight: 700, fontSize: 13, flexShrink: 0,
                }}>
                  {match.score}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-3)" }}>
                    {match.leadTitle}
                  </div>
                  {match.reason && (
                    <div style={{ fontSize: 12, color: "var(--text-5)", marginTop: 3 }}>
                      {match.reason}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "var(--text-6)", flexShrink: 0 }}>
                  {match.caseType}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
