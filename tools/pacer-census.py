#!/usr/bin/env python3
import json, time, urllib.request, urllib.error
from collections import Counter

AUTH_URL = "https://pacer.login.uscourts.gov/services/cso-auth"
PCL_URL  = "https://pcl.uscourts.gov/pcl-public-api/rest/parties/find?page=0"
TCPA = {"485"}                       # Telephone Consumer Protection Act
FDCPA_ETC = {"480", "890", "485"}    # Consumer Credit + Other Statutory + TCPA

def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

# 1) auth
creds = json.load(open("/tmp/pacer-auth.json"))
tok = post(AUTH_URL, creds, {"Content-Type": "application/json", "Accept": "application/json"})["nextGenCSO"]
print(f"Auth OK (token {len(tok)} chars)\n")

defs = json.load(open("/tmp/defendants.json"))
hdr = {"X-NEXT-GEN-CSO": tok, "Content-Type": "application/json", "Accept": "application/json"}

results, spent = [], 0.0
print(f"{'DEFENDANT':<38} {'TOTAL':>7} {'PAGES':>6} {'TCPA%':>6} {'FDCPA+%':>8} {'~TCPA':>6} {'~FDCPA+':>8}")
print("-" * 90)
for d in defs:
    try:
        resp = post(PCL_URL, {"lastName": d["search"], "jurisdictionType": "cv"}, hdr)
    except urllib.error.URLError as e:
        print(f"{d['canonical']:<38} ERROR {e}")
        continue
    spent += 0.10
    pi = resp.get("pageInfo", {}) or {}
    total = pi.get("totalElements", 0)
    pages = pi.get("totalPages", 0)
    content = resp.get("content") or []
    n = len(content) or 1
    tcpa_n = sum(1 for c in content if str(c.get("natureOfSuit")) in TCPA)
    fd_n   = sum(1 for c in content if str(c.get("natureOfSuit")) in FDCPA_ETC)
    tcpa_pct = tcpa_n / n
    fd_pct   = fd_n / n
    est_tcpa = round(total * tcpa_pct)
    est_fd   = round(total * fd_pct)
    results.append({**d, "total_civil": total, "pages": pages,
                    "tcpa_pct": round(tcpa_pct, 3), "fdcpa_pct": round(fd_pct, 3),
                    "est_tcpa": est_tcpa, "est_fdcpa_plus": est_fd,
                    "enum_cost_usd": round(pages * 0.10, 2)})
    print(f"{d['canonical']:<38} {total:>7} {pages:>6} {tcpa_pct:>5.0%} {fd_pct:>7.0%} {est_tcpa:>6} {est_fd:>8}")
    time.sleep(0.3)

json.dump(results, open("/tmp/census-results.json", "w"), indent=2)
tot_enum = sum(r["pages"] for r in results) * 0.10
print("-" * 90)
print(f"\nCensus spend: ${spent:.2f} ({len(results)} defendants)")
print(f"Cost to FULLY enumerate every case across all of them: ${tot_enum:.2f}")
print(f"Total federal civil cases naming these defendants: {sum(r['total_civil'] for r in results):,}")
print(f"Estimated TCPA (NOS 485): {sum(r['est_tcpa'] for r in results):,}")
print(f"Estimated TCPA+FDCPA+statutory (480/485/890): {sum(r['est_fdcpa_plus'] for r in results):,}")
