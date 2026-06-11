#!/usr/bin/env python3
"""Match the national consumer index (NOS 480/371/490) against the FULL
Top-1000 creditor entity list + big-3 bureaus + existing canonical aliases.

Reads a snapshot of _national_consumer_index.json (safe while the pull runs),
extracts the defendant side of each caseTitle, and does guarded containment
matching. Output: _national_entity_matches.json with per-entity case lists,
open counts, and class-candidate counts (open or ran >1.5yr).
"""
import json, re, shutil, sys, unicodedata
from collections import defaultdict
from datetime import date

IDX  = "/Users/stef/MDL Business/data/pacer-cases/_national_consumer_index.json"
SNAP = "/tmp/_national_index_snapshot.json"
OUT  = "/Users/stef/MDL Business/data/pacer-cases/_national_entity_matches.json"
XLSX = "/Users/stef/MDL Business/data/Creditor_Entities_Top1000.xlsx"

shutil.copy(IDX, SNAP)
cases = json.load(open(SNAP))
print(f"index snapshot: {len(cases):,} cases")

# --- build entity needle set ---
import openpyxl
wb = openpyxl.load_workbook(XLSX)
ws = wb["Top 1000 entities"]
rows = list(ws.iter_rows(values_only=True))[1:]

STOP = {"BANK", "FINANCE", "FINANCIAL", "CREDIT", "SERVICES", "LLC", "INC",
        "CO", "CORP", "CORPORAT", "COMPANY", "NA", "USA", "FUNDING", "GROUP",
        "AND", "OF", "THE", "FIRST", "NATIONAL", "AMERICAN", "UNITED",
        "CONSUMER", "HOME", "AUTO", "CARD", "LOAN", "LOANS", "DEPT", "STORE"}

def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).upper()
    s = re.sub(r"[^A-Z0-9& ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

entities = {}   # canonical -> {"needle": str, "consumers": int, "type": str}
skipped = []
for r in rows:
    name, etype, consumers = r[1], r[2], r[4]
    n = norm(name)
    # needle = the distinctive part; require a non-stopword token of len>=4
    toks = [t for t in n.split() if t not in STOP and len(t) >= 4]
    if not toks:
        skipped.append(name); continue
    entities[name] = {"needle": n, "consumers": consumers or 0, "type": etype}

# bureaus — every person in the DB matches all three
for b in ("EQUIFAX", "EXPERIAN", "TRANS UNION"):
    entities[f"{b.title()} (bureau)"] = {"needle": b, "consumers": 10250000, "type": "Credit bureau"}

print(f"entities usable: {len(entities)} (skipped {len(skipped)} too-generic names)")

# guard: needles that are dangerously short/common get word-boundary regex
def make_matcher(needle):
    if len(needle) <= 5 or needle in ("CHASE", "CITI", "ALLY", "AVANT", "UPSTART"):
        rx = re.compile(r"\b" + re.escape(needle) + r"\b")
        return lambda hay, rx=rx: bool(rx.search(hay))
    return lambda hay, n=needle: n in hay

matchers = {name: make_matcher(e["needle"]) for name, e in entities.items()}

def defendant_side(title):
    if not title: return ""
    parts = re.split(r"\bv\.?s?\.\s|\bversus\s", title, maxsplit=1, flags=re.I)
    return norm(parts[1] if len(parts) > 1 else title)

today = date.today()
def ran_long(c):
    try:
        f = date.fromisoformat(c["dateFiled"][:10])
        e = date.fromisoformat(c["dateClosed"][:10]) if c.get("dateClosed") else today
        return (e - f).days > 548
    except Exception:
        return False

per_entity = defaultdict(lambda: {"cases": 0, "open": 0, "candidates": 0, "examples": []})
matched_cases = 0
for c in cases:
    hay = defendant_side(c.get("caseTitle"))
    if not hay: continue
    hits = [name for name, m in matchers.items() if m(hay)]
    if not hits: continue
    matched_cases += 1
    cand = c["status"] == "open" or ran_long(c)
    for name in hits:
        pe = per_entity[name]
        pe["cases"] += 1
        if c["status"] == "open": pe["open"] += 1
        if cand:
            pe["candidates"] += 1
            if len(pe["examples"]) < 10:
                pe["examples"].append({"title": c["caseTitle"], "court": c["courtId"],
                                       "docket": c["caseNumberFull"], "nos": c["natureOfSuit"],
                                       "filed": c["dateFiled"], "status": c["status"]})

result = {
    "_meta": {"built": str(today), "indexCases": len(cases), "matchedCases": matched_cases,
              "entitiesMatched": len(per_entity),
              "note": "containment match on defendant side of caseTitle; candidates = open or ran >18mo"},
    "entities": {}
}
for name, pe in sorted(per_entity.items(), key=lambda kv: -kv[1]["cases"]):
    e = entities[name]
    result["entities"][name] = {"type": e["type"], "consumersInDb": e["consumers"], **pe}

json.dump(result, open(OUT, "w"), indent=1)
print(f"matched {matched_cases:,}/{len(cases):,} cases to {len(per_entity)} entities -> {OUT}")
print("\nTOP 40 BY CASE COUNT:")
print(f"{'ENTITY':<42} {'CASES':>6} {'OPEN':>5} {'CAND':>5} {'DB CONSUMERS':>12}")
for name, v in list(result["entities"].items())[:40]:
    print(f"{name:<42} {v['cases']:>6} {v['open']:>5} {v['candidates']:>5} {v['consumersInDb']:>12,}")
