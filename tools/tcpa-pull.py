#!/usr/bin/env python3
"""Pull the national TCPA (NOS 485) case universe into a unified index.
  Source A: PACER cases/find, year-segmented (authoritative, billable ~$19)
  Source B: CourtListener RECAP search (free, adds coverage + docket_id)
Merged & deduped by normalized (court, docket_number). Resumable."""
import json, re, time, os, urllib.request, urllib.error, urllib.parse

OUT      = "/Users/stef/MDL Business/data/pacer-cases/_tcpa_index.json"
ENVFILE  = "/Users/stef/MDL Business/.env.local"
AUTH     = "https://pacer.login.uscourts.gov/services/cso-auth"
CASES    = "https://pcl.uscourts.gov/pcl-public-api/rest/cases/find?page={page}"
CL       = "https://www.courtlistener.com/api/rest/v4"

def cl_court(pc):                      # PACER "flmdc" -> CL "flmd"
    return pc[:-1] if pc and pc.endswith("c") else pc
def cl_docket_number(full):            # "8:2026cv01234" -> "8:26-cv-01234"
    m = re.match(r"^(\d+):(\d{4})([a-z]+)(\d+)$", full or "")
    if not m: return None
    o, y, t, n = m.groups(); return f"{o}:{y[2:]}-{t}-{n}"
def norm_dn(dn):                       # normalize CL docket numbers to a comparable key
    if not dn: return None
    return re.sub(r"\s+", "", dn.lower())

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

def cl_get(url, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Token {TOKEN}"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(5*(a+1)); continue
            if e.code in (500,502,503,504) and a < tries-1: time.sleep(2**a); continue
            return None
        except Exception:
            if a < tries-1: time.sleep(2**a); continue
            return None
    return None

TOKEN = [l.split('=',1)[1].strip() for l in open(ENVFILE) if l.startswith('COURTLISTENER_API_TOKEN')][0]
idx = {}
if os.path.exists(OUT):
    idx = {f"{r['court']}::{norm_dn(r['docket_number'])}": r for r in json.load(open(OUT))}
    print(f"resuming: {len(idx)} cases already in index")

def upsert(court, dn, **fields):
    if not court or not dn: return
    key = f"{court}::{norm_dn(dn)}"
    rec = idx.get(key) or {"court": court, "docket_number": dn, "caseTitle": None,
                           "natureOfSuit": "485", "dateFiled": None, "dateClosed": None,
                           "status": None, "pacer_caseId": None, "cl_docket_id": None,
                           "sources": []}
    for k, v in fields.items():
        if v is not None and (rec.get(k) in (None, "") or k in ("cl_docket_id","pacer_caseId")):
            rec[k] = v
    if rec["dateClosed"]: rec["status"] = "closed"
    elif rec["status"] is None: rec["status"] = "open"
    idx[key] = rec

# ---- Source A: PACER, year by year ----
hdr = post(AUTH, json.load(open("/tmp/pacer-auth.json")),
           {"Content-Type":"application/json","Accept":"application/json"})
hdr = {"X-NEXT-GEN-CSO": hdr["nextGenCSO"], "Content-Type":"application/json","Accept":"application/json"}
print("=== PACER NOS 485 enumeration ===", flush=True)
pacer_pages = 0
for y in range(2015, 2027):
    page, total_pages = 0, None
    while True:
        body = {"natureOfSuit":["485"], "dateFiledFrom":f"{y}-01-01", "dateFiledTo":f"{y}-12-31"}
        resp = post(CASES.format(page=page), body, hdr)
        if "status" in resp: print(f"  {y} p{page}: {resp.get('message')}"); break
        pacer_pages += 1
        pi = resp.get("pageInfo", {})
        if total_pages is None: total_pages = pi.get("totalPages", 0)
        for c in resp.get("content") or []:
            if c.get("caseType") != "cv": continue
            cc = c.get("courtCase") or {}
            upsert(cl_court(c.get("courtId")), c.get("caseNumberFull"),
                   caseTitle=c.get("caseTitle"), dateFiled=c.get("dateFiled"),
                   dateClosed=cc.get("effectiveDateClosed") or c.get("dateTermed"),
                   pacer_caseId=c.get("caseId"))
        page += 1
        if total_pages is None or page >= total_pages: break
        time.sleep(0.25)
    json.dump(list(idx.values()), open(OUT,"w"))
    print(f"  {y}: index now {len(idx):,} (pacer pages so far {pacer_pages}, ${pacer_pages*0.10:.2f})", flush=True)

# ---- Source B: CourtListener free search ----
print("=== CourtListener free NOS 485 ===", flush=True)
url = f"{CL}/search/?type=r&nature_of_suit=485&order_by=dateFiled%20desc"
n, added_before = 0, len(idx)
while url:
    d = cl_get(url)
    if not d: break
    for r in d.get("results", []):
        upsert(r.get("court_id"), r.get("docketNumber"),
               caseTitle=r.get("caseName"), dateFiled=r.get("dateFiled"),
               dateClosed=r.get("dateTerminated"), cl_docket_id=r.get("docket_id"))
    n += len(d.get("results", []))
    # mark source
    url = d.get("next")
    if n % 200 == 0:
        json.dump(list(idx.values()), open(OUT,"w"))
        print(f"  CL processed {n}, index now {len(idx):,}", flush=True)
    time.sleep(0.2)

json.dump(list(idx.values()), open(OUT,"w"))
openc = sum(1 for r in idx.values() if r["status"]=="open")
both  = sum(1 for r in idx.values() if r["pacer_caseId"] and r["cl_docket_id"])
clonly= sum(1 for r in idx.values() if r["cl_docket_id"] and not r["pacer_caseId"])
print(f"\nDONE. unified TCPA index: {len(idx):,} cases  open={openc} closed={len(idx)-openc}")
print(f"  in both PACER+RECAP: {both:,} | RECAP-only: {clonly:,} | PACER pages billed: {pacer_pages} (${pacer_pages*0.10:.2f})")
