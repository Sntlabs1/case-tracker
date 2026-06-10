#!/usr/bin/env python3
"""Enumerate all member cases of data-breach/privacy MDLs via PACER PCL jpmlNumber search.
Authoritative, works regardless of the CourtListener throttle. Checkpointed."""
import json, time, os, urllib.request, urllib.error

AUTH  = "https://pacer.login.uscourts.gov/services/cso-auth"
CASES = "https://pcl.uscourts.gov/pcl-public-api/rest/cases/find?page={page}"
OUT   = "/Users/stef/MDL Business/data/pacer-cases/_breach_mdl_index.json"

# JPML pending data-breach / privacy MDLs (from JPML Pending Dockets, Jan 5 2026)
MDLS = [
    ("2358", "Google Cookie Placement Privacy"),
    ("2843", "Facebook Consumer Privacy"),
    ("2879", "Marriott Customer Data Breach"),
    ("2904", "American Medical Collection Agency (AMCA) Data Breach"),
    ("2967", "Clearview AI Privacy"),
    ("2972", "Blackbaud Data Breach"),
    ("3073", "T-Mobile 2022 Data Breach"),
    ("3083", "MOVEit Data Breach"),
    ("3096", "Perry Johnson & Associates Data Breach"),
    ("3098", "23andMe Data Breach"),
    ("3108", "Change Healthcare Data Breach"),
    ("3114", "AT&T Customer Data Breach"),
    ("3126", "Snowflake Data Breach"),
    ("3127", "Evolve Bank & Trust Data Breach"),
    ("3144", "TikTok Minor Privacy"),
    ("3149", "PowerSchool Data Breach"),
    ("3153", "Coinbase Data Breach"),
    ("3159", "Keffer Development Data Breach"),
    ("3170", "Trans Union Data Breach"),
]

def post(u, b, h, tries=4):
    for a in range(tries):
        try:
            r = urllib.request.Request(u, data=json.dumps(b).encode(), method="POST")
            for k, v in h.items(): r.add_header(k, v)
            with urllib.request.urlopen(r, timeout=90) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504) and a < tries-1: time.sleep(2**a+1); continue
            raise
        except Exception:
            if a < tries-1: time.sleep(2**a+1); continue
            raise

def auth():
    t = post(AUTH, json.load(open("/tmp/pacer-auth.json")),
             {"Content-Type":"application/json","Accept":"application/json"})["nextGenCSO"]
    return {"X-NEXT-GEN-CSO": t, "Content-Type":"application/json","Accept":"application/json"}

def main():
    hdr = auth()
    cases = {}
    if os.path.exists(OUT):
        cases = {f"{r['courtId']}::{r['caseId']}": r for r in json.load(open(OUT))}
        print(f"resuming: {len(cases)} member cases loaded")
    pages_total = 0
    print(f"Enumerating {len(MDLS)} breach/privacy MDLs\n")
    for num, name in MDLS:
        page, total_pages, before = 0, None, len(cases)
        while True:
            resp = post(CASES.format(page=page), {"jpmlNumber": num}, hdr)
            if "status" in resp: print(f"  MDL {num} {name}: {resp.get('message')}"); break
            pages_total += 1
            pi = resp.get("pageInfo", {})
            if total_pages is None: total_pages = pi.get("totalPages", 0)
            for c in resp.get("content") or []:
                cc = c.get("courtCase") or {}
                close = cc.get("effectiveDateClosed") or c.get("dateTermed") or None
                key = f"{c.get('courtId')}::{c.get('caseId')}"
                rec = cases.get(key) or {
                    "mdl": num, "mdlName": name,
                    "courtId": c.get("courtId"), "caseId": c.get("caseId"),
                    "caseNumberFull": c.get("caseNumberFull"), "caseTitle": c.get("caseTitle"),
                    "natureOfSuit": c.get("natureOfSuit"), "caseType": c.get("caseType"),
                    "dateFiled": c.get("dateFiled"), "dateClosed": close,
                    "status": "closed" if close else "open",
                    "jurisdictionType": c.get("jurisdictionType"),
                    "caseLink": cc.get("caseLink"),
                }
                cases[key] = rec
            page += 1
            if total_pages is None or page >= total_pages: break
            time.sleep(0.25)
        json.dump(list(cases.values()), open(OUT, "w"), indent=2)
        print(f"  MDL {num:>4} {name:<42} +{len(cases)-before:>4} cases (running total {len(cases)})", flush=True)
        time.sleep(0.3)
    openc = sum(1 for r in cases.values() if r["status"] == "open")
    print(f"\nDONE. breach-MDL member cases: {len(cases)} | open={openc} closed={len(cases)-openc}")
    print(f"PACER pages billed: {pages_total} (${pages_total*0.10:.2f})")

if __name__ == "__main__":
    main()
