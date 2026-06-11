#!/usr/bin/env python3
"""Pull the NATIONAL consumer case universe (NOS 480 Consumer Credit,
371 Truth in Lending, 490 Cable/Sat TV) into one unified index.

PCL caps any query at 5,401 results; NOS 480 exceeds that EVERY year,
so 480 is month-segmented while 371/490 are year-segmented.
Newest years first so the most matchable data lands earliest.
Resumable via a segment checkpoint sidecar. ~$0.10 per 54-record page.
"""
import json, os, time, urllib.request, urllib.error

OUT  = "/Users/stef/MDL Business/data/pacer-cases/_national_consumer_index.json"
CKPT = "/Users/stef/MDL Business/data/pacer-cases/_national_consumer_ckpt.json"
AUTH  = "https://pacer.login.uscourts.gov/services/cso-auth"
CASES = "https://pcl.uscourts.gov/pcl-public-api/rest/cases/find?page={page}"

MONTH_END = {1:31,2:29,3:31,4:30,5:31,6:30,7:31,8:31,9:30,10:31,11:30,12:31}

def post(u, b, h, tries=5):
    for a in range(tries):
        try:
            r = urllib.request.Request(u, data=json.dumps(b).encode(), method="POST")
            for k, v in h.items(): r.add_header(k, v)
            with urllib.request.urlopen(r, timeout=90) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): raise          # token expired -> reauth in caller
            if e.code in (429, 500, 502, 503, 504) and a < tries - 1:
                time.sleep(2 ** a + 1); continue
            raise
        except Exception:
            if a < tries - 1: time.sleep(2 ** a + 1); continue
            raise

def auth():
    t = post(AUTH, json.load(open("/tmp/pacer-auth.json")),
             {"Content-Type": "application/json", "Accept": "application/json"})["nextGenCSO"]
    return {"X-NEXT-GEN-CSO": t, "Content-Type": "application/json", "Accept": "application/json"}

idx, done = {}, set()
if os.path.exists(OUT):
    idx = {f"{r['courtId']}::{r['caseNumberFull']}": r for r in json.load(open(OUT))}
if os.path.exists(CKPT):
    done = set(json.load(open(CKPT)))
print(f"resuming: {len(idx):,} cases, {len(done)} segments done", flush=True)

# segments: (label, nos, from, to) — newest first
segments = []
for y in range(2026, 2014, -1):
    months = range(6, 0, -1) if y == 2026 else range(12, 0, -1)
    for m in months:
        segments.append((f"480:{y}-{m:02d}", "480", f"{y}-{m:02d}-01", f"{y}-{m:02d}-{MONTH_END[m]}"))
for nos in ("371", "490"):
    for y in range(2026, 2014, -1):
        segments.append((f"{nos}:{y}", nos, f"{y}-01-01", f"{y}-12-31"))

hdr = auth()
pages_billed = 0
def save():
    json.dump(list(idx.values()), open(OUT, "w"))
    json.dump(sorted(done), open(CKPT, "w"))

for label, nos, dfrom, dto in segments:
    if label in done: continue
    page, total_pages, seg_n = 0, None, 0
    while True:
        body = {"natureOfSuit": [nos], "dateFiledFrom": dfrom, "dateFiledTo": dto}
        try:
            resp = post(CASES.format(page=page), body, hdr)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                hdr = auth(); continue
            raise
        if "status" in resp and "content" not in resp:
            print(f"  {label} p{page}: API msg {resp.get('message')}", flush=True); break
        pages_billed += 1
        pi = resp.get("pageInfo", {}) or {}
        if total_pages is None:
            total_pages = pi.get("totalPages", 0)
            if pi.get("totalElements", 0) >= 5401:
                print(f"  WARNING {label} capped at 5401 — segment too big", flush=True)
        for c in resp.get("content") or []:
            if c.get("caseType") != "cv": continue
            key = f"{c.get('courtId')}::{c.get('caseNumberFull')}"
            cc = c.get("courtCase") or {}
            closed = cc.get("effectiveDateClosed") or c.get("dateTermed")
            idx[key] = {"courtId": c.get("courtId"), "caseId": c.get("caseId"),
                        "caseNumberFull": c.get("caseNumberFull"),
                        "caseTitle": c.get("caseTitle"), "natureOfSuit": nos,
                        "dateFiled": c.get("dateFiled"), "dateClosed": closed,
                        "status": "closed" if closed else "open",
                        "caseLink": c.get("caseLink")}
            seg_n += 1
        page += 1
        if total_pages is None or page >= total_pages: break
        time.sleep(0.25)
    done.add(label); save()
    print(f"{label}: +{seg_n} -> index {len(idx):,} | pages {pages_billed} (${pages_billed*0.10:.2f})", flush=True)

save()
openc = sum(1 for r in idx.values() if r["status"] == "open")
print(f"\nDONE. national consumer index: {len(idx):,} cases  open={openc:,} closed={len(idx)-openc:,}")
print(f"pages billed this run: {pages_billed} (${pages_billed*0.10:.2f})")
