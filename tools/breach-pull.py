#!/usr/bin/env python3
"""Data-breach case discovery via CourtListener full-text RECAP search (free).
Data breach has NO Nature-of-Suit code, so we search the actual breach language.
Slow-paced to respect CL's rate limit. Checkpointed & resumable.

Run: python3 tools/breach-pull.py
If CL returns a long Retry-After (rate-limited), it reports and exits cleanly;
just rerun later and it resumes from the checkpoint."""
import json, time, os, re, urllib.request, urllib.parse, urllib.error

OUT     = "/Users/stef/MDL Business/data/pacer-cases/_breach_index.json"
ENVFILE = "/Users/stef/MDL Business/.env.local"
CL      = "https://www.courtlistener.com/api/rest/v4"
PACE    = 4.0           # seconds between requests (be polite to the search endpoint)

# Full-text queries. '"data breach"' is broadest; others catch cases that use
# different phrasing. All results merged & deduped by (court, docket_number).
QUERIES = [
    '"data breach"',
    '"data security incident"',
    '"unauthorized access" "personal information"',
    '"personally identifiable information" breach',
]
# Heuristics to flag genuine breach class actions vs incidental mentions.
CLASS_HINT = re.compile(r"class action|on behalf of|individually and", re.I)

TOKEN = [l.split('=',1)[1].strip() for l in open(ENVFILE) if l.startswith('COURTLISTENER_API_TOKEN')][0]

def cl(path):
    """GET with rate-limit awareness. Returns dict, or None on giving up.
    On a long Retry-After, raises Throttled so the caller can checkpoint+exit."""
    for attempt in range(6):
        try:
            req = urllib.request.Request(CL + path, headers={"Authorization": f"Token {TOKEN}"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = int(e.headers.get("retry-after", "60"))
                if ra > 180:
                    raise Throttled(ra)
                time.sleep(ra + 2); continue
            if e.code in (500,502,503,504) and attempt < 5:
                time.sleep(2 ** attempt); continue
            return None
        except Exception:
            if attempt < 5: time.sleep(2 ** attempt); continue
            return None
    return None

class Throttled(Exception):
    def __init__(self, secs): self.secs = secs

def norm_dn(dn): return re.sub(r"\s+", "", (dn or "").lower())

def load():
    if os.path.exists(OUT):
        return {f"{r['court']}::{norm_dn(r['docket_number'])}": r for r in json.load(open(OUT))}
    return {}

def save(idx): json.dump(list(idx.values()), open(OUT, "w"))

def upsert(idx, r, query):
    court, dn = r.get("court_id"), r.get("docketNumber")
    if not court or not dn: return
    key = f"{court}::{norm_dn(dn)}"
    name = r.get("caseName") or ""
    rec = idx.get(key) or {"court": court, "docket_number": dn, "caseTitle": name,
        "natureOfSuit": str(r.get("suitNature") or ""), "dateFiled": r.get("dateFiled"),
        "dateClosed": r.get("dateTerminated"),
        "status": "closed" if r.get("dateTerminated") else "open",
        "cl_docket_id": r.get("docket_id"), "matched_queries": [],
        "likely_class": bool(CLASS_HINT.search(name))}
    if query not in rec["matched_queries"]: rec["matched_queries"].append(query)
    idx[key] = rec

def main():
    idx = load()
    print(f"breach index: {len(idx)} cases loaded", flush=True)
    try:
        for q in QUERIES:
            url = "/search/?type=r&q=" + urllib.parse.quote(q) + "&order_by=dateFiled%20desc"
            n = 0
            while url:
                d = cl(url)
                if not d: break
                if n == 0:
                    print(f'  query {q!r}: {d.get("count")} total dockets', flush=True)
                for r in d.get("results", []):
                    upsert(idx, r, q)
                n += len(d.get("results", []))
                nxt = d.get("next")
                url = nxt.replace(CL, "") if nxt else None
                if n % 100 == 0:
                    save(idx)
                    print(f"    {q!r}: {n} processed, index {len(idx)}", flush=True)
                time.sleep(PACE)
            save(idx)
            print(f"  done {q!r}: index now {len(idx)}", flush=True)
    except Throttled as t:
        save(idx)
        print(f"\nRATE-LIMITED: CourtListener Retry-After={t.secs}s (~{t.secs//3600}h{(t.secs%3600)//60}m).")
        print(f"Checkpoint saved ({len(idx)} cases). Rerun `python3 tools/breach-pull.py` after the cooldown to resume.")
        return
    save(idx)
    cls = sum(1 for r in idx.values() if r["likely_class"])
    openc = sum(1 for r in idx.values() if r["status"] == "open")
    print(f"\nDONE. breach index: {len(idx)} cases | likely_class={cls} | open={openc} closed={len(idx)-openc}")

if __name__ == "__main__":
    main()
