#!/usr/bin/env python3
"""Full PCL enumeration of FDCPA/FCRA/TCPA (NOS 480/485/890) civil cases
naming each high-signal defendant. Checkpointed per-defendant so spend is protected."""
import json, time, os, urllib.request, urllib.error

AUTH_URL = "https://pacer.login.uscourts.gov/services/cso-auth"
PCL_URL  = "https://pcl.uscourts.gov/pcl-public-api/rest/parties/find?page={page}"
KEEP_NOS = {"480", "485", "890"}     # Consumer Credit (FDCPA/FCRA), TCPA, Other Statutory
OUTDIR   = "/Users/stef/MDL Business/data/pacer-cases"
CREDS    = "/tmp/pacer-auth.json"
DEFS     = "/tmp/defendants.json"

def post(url, body, headers, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
            for k, v in headers.items(): req.add_header(k, v)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2 ** attempt + 1); continue
            raise
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(2 ** attempt + 1); continue
            raise

def authenticate():
    tok = post(AUTH_URL, json.load(open(CREDS)),
               {"Content-Type": "application/json", "Accept": "application/json"})["nextGenCSO"]
    return {"X-NEXT-GEN-CSO": tok, "Content-Type": "application/json", "Accept": "application/json"}

def enumerate_defendant(d, hdr):
    """Returns (cases_dict_keyed_by_courtId+caseId, billable_pages)."""
    cases, pages_fetched, page = {}, 0, 0
    total_pages = None
    while True:
        body = {"lastName": d["search"], "jurisdictionType": "cv"}
        resp = post(PCL_URL.format(page=page), body, hdr)
        if "status" in resp:            # validation error
            print(f"    ! {d['canonical']}: {resp.get('message')}"); break
        pages_fetched += 1
        pi = resp.get("pageInfo", {}) or {}
        if total_pages is None:
            total_pages = pi.get("totalPages", 0)
        for c in resp.get("content") or []:
            if str(c.get("natureOfSuit")) not in KEEP_NOS: continue
            if c.get("caseType") != "cv": continue
            cc = c.get("courtCase") or {}
            key = f"{c.get('courtId')}::{c.get('caseId')}"
            close_date = cc.get("effectiveDateClosed") or c.get("dateTermed") or None
            rec = cases.get(key) or {
                "courtId": c.get("courtId"),
                "caseId": c.get("caseId"),
                "caseNumberFull": c.get("caseNumberFull"),
                "caseTitle": c.get("caseTitle"),
                "natureOfSuit": c.get("natureOfSuit"),
                "dateFiled": c.get("dateFiled"),
                "dateClosed": close_date,
                "status": "closed" if close_date else "open",
                "caseLink": cc.get("caseLink"),
                "matchedDefendants": [],
            }
            if d["canonical"] not in rec["matchedDefendants"]:
                rec["matchedDefendants"].append(d["canonical"])
            cases[key] = rec
        page += 1
        if total_pages is None or page >= total_pages: break
        time.sleep(0.25)
    return cases, pages_fetched

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    defs = json.load(open(DEFS))
    hdr = authenticate()
    print(f"Auth OK. Enumerating {len(defs)} defendants (NOS {sorted(KEEP_NOS)}, civil)\n")
    total_pages = 0
    for i, d in enumerate(defs, 1):
        safe = d["canonical"].replace("/", "-").replace(" ", "_")
        outfile = os.path.join(OUTDIR, f"{safe}.json")
        if os.path.exists(outfile):
            existing = json.load(open(outfile))
            print(f"[{i}/{len(defs)}] {d['canonical']:<38} SKIP (done, {existing['caseCount']} cases)")
            continue
        try:
            cases, pages = enumerate_defendant(d, hdr)
        except Exception as e:
            print(f"[{i}/{len(defs)}] {d['canonical']:<38} ERROR {e} -- re-auth & retry")
            hdr = authenticate()
            cases, pages = enumerate_defendant(d, hdr)
        total_pages += pages
        out = {"defendant": d["canonical"], "search": d["search"], "category": d["cat"],
               "caseCount": len(cases), "billablePages": pages,
               "openCases": sum(1 for c in cases.values() if c["status"] == "open"),
               "closedCases": sum(1 for c in cases.values() if c["status"] == "closed"),
               "cases": list(cases.values())}
        json.dump(out, open(outfile, "w"), indent=2)
        print(f"[{i}/{len(defs)}] {d['canonical']:<38} {len(cases):>5} cases  ({pages} pg, ${pages*0.10:.2f})  open={out['openCases']} closed={out['closedCases']}")
        time.sleep(0.3)
    print(f"\nDONE. Billable pages this run: {total_pages}  (${total_pages*0.10:.2f})")

if __name__ == "__main__":
    main()
