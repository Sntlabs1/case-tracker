#!/usr/bin/env python3
"""Phase 2: RECAP (CourtListener) free docket pass over class-action candidates.
Flags settlement-related docket entries + dates. Checkpointed & resumable."""
import json, time, os, re, sys, urllib.request, urllib.error, urllib.parse

CL = "https://www.courtlistener.com/api/rest/v4"
TOKEN = None
CAND = "/Users/stef/MDL Business/data/pacer-cases/_candidates.json"
OUT  = "/Users/stef/MDL Business/data/pacer-cases/_settlements.json"

KEYWORDS = [
    ("class_settlement", re.compile(r"class.{0,15}settlement|settlement class", re.I)),
    ("final_approval",   re.compile(r"final approval|final judgment|order approving|approving (the )?settlement", re.I)),
    ("prelim_approval",  re.compile(r"prelim\w*.{0,15}approval|motion.{0,15}settlement", re.I)),
    ("opt_out",          re.compile(r"opt.?out|exclusion|object\w*", re.I)),
    ("class_cert",       re.compile(r"class cert", re.I)),
    ("settlement",       re.compile(r"settlement|settle\w*|consent (judgment|decree)|stipulat\w* (of )?dismissal", re.I)),
]
CLASS_SIGNALS = {"class_settlement", "final_approval", "class_cert"}

def get_token():
    for line in open("/Users/stef/MDL Business/.env.local"):
        if line.startswith("COURTLISTENER_API_TOKEN"):
            return line.split("=", 1)[1].strip()
    return ""

def api_get(path, tries=4):
    url = f"{CL}{path}"
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Token {TOKEN}"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1)); continue
            if e.code in (500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2 ** attempt); continue
            return None
        except Exception:
            if attempt < tries - 1: time.sleep(2 ** attempt); continue
            return None
    return None

def cl_court(pacer_court):           # "ilndc" -> "ilnd"
    return pacer_court[:-1] if pacer_court.endswith("c") else pacer_court

def cl_docket_number(full):          # "1:2011cv03104" -> "1:11-cv-03104"
    m = re.match(r"^(\d+):(\d{4})([a-z]+)(\d+)$", full or "")
    if not m: return None
    office, year, typ, num = m.groups()
    return f"{office}:{year[2:]}-{typ}-{num}"

def scan_entry(desc):
    hits = set()
    for label, rx in KEYWORDS:
        if rx.search(desc or ""): hits.add(label)
    return hits

def process(case):
    court = cl_court(case["courtId"])
    dn = cl_docket_number(case["caseNumberFull"])
    rec = {"caseKey": f"{case['courtId']}::{case['caseId']}", "court": court,
           "docket_number": dn, "caseTitle": case["caseTitle"], "natureOfSuit": case["natureOfSuit"],
           "dateFiled": case["dateFiled"], "dateClosed": case["dateClosed"], "status": case["status"],
           "matchedDefendants": case["matchedDefendants"],
           "recap_found": False, "docket_id": None, "signals": [], "is_class_settlement": False,
           "earliest_settlement_date": None, "final_approval_date": None}
    if not dn:
        return rec
    d = api_get(f"/dockets/?court={court}&docket_number={urllib.parse.quote(dn)}")
    if not d or not d.get("results"):
        return rec
    docket = d["results"][0]
    rec["recap_found"] = True
    rec["docket_id"] = docket.get("id")
    # docket entries (up to 2 pages = 200 entries)
    entries, page_url = [], f"/docket-entries/?docket={docket['id']}&page_size=100"
    for _ in range(2):
        de = api_get(page_url)
        if not de: break
        entries += de.get("results", [])
        nxt = de.get("next")
        if not nxt: break
        page_url = nxt.replace(CL, "")
    sig_types = set()
    for e in entries:
        hits = scan_entry(e.get("description"))
        if not hits: continue
        df = e.get("date_filed")
        for h in hits:
            rec["signals"].append({"date": df, "entry": e.get("entry_number"), "type": h,
                                   "snippet": (e.get("description") or "")[:160]})
        sig_types |= hits
        settle_dates = [s["date"] for s in rec["signals"] if s["date"] and s["type"] in ("settlement", "class_settlement")]
        if settle_dates:
            rec["earliest_settlement_date"] = min(settle_dates)
        fa = [s["date"] for s in rec["signals"] if s["date"] and s["type"] == "final_approval"]
        if fa: rec["final_approval_date"] = max(fa)
    rec["is_class_settlement"] = bool(sig_types & CLASS_SIGNALS)
    return rec

def main():
    global TOKEN
    TOKEN = get_token()
    cands = json.load(open(CAND))
    if "--test" in sys.argv:
        cands = cands[:int(sys.argv[sys.argv.index("--test")+1])]
    done = {}
    if os.path.exists(OUT):
        done = {r["caseKey"]: r for r in json.load(open(OUT))}
    print(f"RECAP pass: {len(cands)} candidates, {len(done)} already done", flush=True)
    results = dict(done)
    n_recap = sum(1 for r in done.values() if r["recap_found"])
    n_settle = sum(1 for r in done.values() if r["signals"])
    n_class = sum(1 for r in done.values() if r["is_class_settlement"])
    for i, c in enumerate(cands, 1):
        key = f"{c['courtId']}::{c['caseId']}"
        if key in results: continue
        r = process(c)
        results[key] = r
        if r["recap_found"]: n_recap += 1
        if r["signals"]: n_settle += 1
        if r["is_class_settlement"]: n_class += 1
        if i % 50 == 0 or "--test" in sys.argv:
            json.dump(list(results.values()), open(OUT, "w"))
            print(f"  [{i}/{len(cands)}] recap_found={n_recap} with_settlement_entries={n_settle} class_settlements={n_class}", flush=True)
        time.sleep(0.2)
    json.dump(list(results.values()), open(OUT, "w"))
    print(f"DONE. processed={len(results)} recap_found={n_recap} settlement_entries={n_settle} class_settlements={n_class}", flush=True)

if __name__ == "__main__":
    main()
