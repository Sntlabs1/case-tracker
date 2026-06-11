#!/usr/bin/env python3
"""Build the defendant-token -> CLAIM PATH registry and audit person coverage.

A person's case match is only worth outreach if the defendant connects to a
live path today:
  claim_window         - an open settlement (deadline ahead, automatic payment,
                         or rolling mass-arb sign-up)
  joinable_litigation  - open putative class candidates / open dockets naming
                         the defendant (absent-class-member or originate pool)
  monitor_only         - settlement pending (claims not open yet)
  none                 - nothing live; outreach must not promise a claim

Sources: data/settlements/open-settlements-2026-06.json (wave-1, verified),
open-settlements-wave2-2026-06.json (aggregator sweep, mostly unverified),
data/pacer-cases/_breach_settlements_open.json, _candidates.json (class-screened
open FDCPA candidates), _national_entity_matches.json (open dockets per entity),
_tcpa_index.json (open TCPA dockets per defendant).

Writes data/case-claim-paths.json + KV case:claim_paths, then audits the
casepeople:* person indexes in prod KV against the registry.
"""
import json, os, re, ssl, http.client, sys
from collections import defaultdict
from datetime import date
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from defendant_token import canonical_token

ROOT  = "/Users/stef/MDL Business"
TODAY = date.today()

# ── KV REST helpers (same pattern as credit-rederive.py) ─────────────────────
for line in open(f"{ROOT}/.env.local"):
    if line.startswith("KV_REST_API_URL"):   os.environ["KV_REST_API_URL"] = line.split("=", 1)[1].strip().strip('"')
    if line.startswith("KV_REST_API_TOKEN"): os.environ["KV_REST_API_TOKEN"] = line.split("=", 1)[1].strip().strip('"')
KV_URL, KV_TOKEN = os.environ["KV_REST_API_URL"], os.environ["KV_REST_API_TOKEN"]
_KV_HOST = urlparse(KV_URL).netloc
_KV_CTX  = ssl.create_default_context()

def kv_pipeline(commands):
    c = http.client.HTTPSConnection(_KV_HOST, context=_KV_CTX, timeout=60)
    body = json.dumps(commands).encode()
    c.request("POST", "/pipeline", body=body, headers={
        "Authorization": f"Bearer {KV_TOKEN}", "Content-Type": "application/json",
        "Content-Length": str(len(body))})
    return json.loads(c.getresponse().read())

def kv_scan_keys(match):
    keys, cursor = [], "0"
    while True:
        res = kv_pipeline([["SCAN", cursor, "MATCH", match, "COUNT", "1000"]])
        cursor, batch = res[0]["result"]
        keys.extend(batch)
        if cursor == "0":
            return keys

# ── 1. Collect settlements from all catalogs ────────────────────────────────
DATE_RX = re.compile(r"(20\d\d)-(\d\d)-(\d\d)")

def window_type(deadline_text, status_text=""):
    """Classify a settlement's claim window as of TODAY."""
    blob = f"{deadline_text or ''} {status_text or ''}".lower()
    m = DATE_RX.search(blob)
    if m:
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if d >= TODAY:
            return "open_claim_window", d.isoformat()
        # a past date is only fatal if nothing says payments continue
        if not re.search(r"automatic|paying|auto-pay|no claim|rolling", blob):
            return "expired", d.isoformat()
    if re.search(r"automatic|paying|auto-pay|auto-credit|no claim form|checks", blob):
        return "automatic_payment", None
    if re.search(r"rolling|mass arb|no deadline", blob):
        return "rolling", None
    if re.search(r"pending|monitor|tba|tbd|preliminary|not yet open|register", blob):
        return "monitor", None
    if re.search(r"open", blob):
        return "open_claim_window", None
    return "unknown", None

settlements = []  # {token, defendant, name, windowType, deadline, verified, source}

# Settlement defendant strings that must ALSO register under the canonical
# tradeline tokens the person signals carry (defendant_token.py aliases handle
# most spellings, but bare brand names like "Ford"/"GM" and multi-entity
# strings like "Hyundai / Kia" don't hit the alias needles).
SETTLEMENT_EXTRA_TOKENS = {
    "hyundai": ["hyundai capital", "kia finance"],
    "kia":     ["kia finance"],
    "ford":    ["ford motor credit"],
    "gm":      ["gm financial"],
    "toyota":  ["toyota motor credit"],
    "nissan":  ["nissan motor acceptance"],
    "mercedes":["mercedes benz financial"],
}

def add_settlement(defendant, name, deadline_text, status_text, verified, source, extra=None):
    wt, dl = window_type(deadline_text, status_text)
    toks = set()
    tok = canonical_token(defendant or "")
    if tok:
        toks.add(tok)
    dl_low = " " + re.sub(r"[^a-z0-9]+", " ", str(defendant or "").lower()) + " "
    for key, extra_toks in SETTLEMENT_EXTRA_TOKENS.items():
        if f" {key} " in dl_low:
            toks.update(extra_toks)
    for t in toks:
        row = dict(token=t, defendant=defendant, name=(name or defendant)[:120],
                   windowType=wt, deadline=dl, verified=bool(verified), source=source)
        for k, v in (extra or {}).items():
            if v not in (None, ""):
                row[k] = v
        settlements.append(row)

def catalog_extra(s):
    """Carry the recovery facts a catalog row already holds into the registry."""
    return dict(fund=s.get("fund"), perClaimant=s.get("perClaimant"),
                classDefinition=(s.get("classDefinition") or "")[:400] or None)

w1 = json.load(open(f"{ROOT}/data/settlements/open-settlements-2026-06.json"))
for s in w1.get("frictionless", []) + w1.get("claim_filing", []):
    add_settlement(s.get("defendant"), s.get("settlement"), s.get("deadline"), s.get("status"), True, "wave1",
                   catalog_extra(s))
for s in w1.get("mass_arb", []):
    add_settlement(s.get("defendant"), s.get("program"), None, s.get("status") or "rolling", True, "wave1",
                   catalog_extra(s))
for s in w1.get("structural_recurring", []):
    # recurring-defendant theory, not a live window by itself
    add_settlement(s.get("defendant"), s.get("basis"), None, "monitor", True, "wave1-structural")

w2 = json.load(open(f"{ROOT}/data/settlements/open-settlements-wave2-2026-06.json"))
for section in ("high_value_population_plays", "banking_credit_lending",
                "auto_matchable_by_tradeline", "data_breach_consumer_financial",
                "privacy_tcpa_facta", "ftc_redress"):
    for s in w2.get(section, []):
        add_settlement(s.get("defendant"), s.get("settlement") or s.get("note"),
                       s.get("deadline"), s.get("status") or s.get("note"),
                       s.get("verified", False), f"wave2:{section}", catalog_extra(s))
for s in w2.get("monitor_not_yet_open", []):
    add_settlement(s.get("defendant"), s.get("fund"), None, "monitor", False, "wave2:monitor")

br = json.load(open(f"{ROOT}/data/pacer-cases/_breach_settlements_open.json"))
for s in br.get("settlements", []):
    add_settlement(s.get("name"), f"{s.get('name')} data breach settlement",
                   s.get("deadline"), s.get("status") or "open", True, "breach-open",
                   dict(fund=s.get("fund"),
                        perClaimant=" / ".join(filter(None, [s.get("flatPayout"),
                                                             f"up to {s['documentedMax']} documented" if s.get("documentedMax") else None,
                                                             s.get("extras")])) or None,
                        classDefinition=s.get("eligibility"),
                        claimsUrl=s.get("portal")))

print(f"settlements collected: {len(settlements)} across {len({s['token'] for s in settlements})} defendant tokens")

# ── 1b. Overlay verified administrator-site facts ────────────────────────────
# data/settlements/settlement-admin-sites.json holds what each settlement's
# OWN administrator site publishes (claims URL, fund, class definition,
# important dates, claim-form requirement), verified on verifiedOn. A matched
# admin record is authoritative: it overrides the aggregator-sourced window
# type, deadline, and dollar fields.
ADMIN = json.load(open(f"{ROOT}/data/settlements/settlement-admin-sites.json"))["settlements"]

def admin_record_for(row):
    blob = f"{row.get('name', '')} {row.get('defendant', '')}".lower()
    for rec in ADMIN:
        if row["token"] in rec["tokens"] and any(nd in blob for nd in rec["nameNeedles"]):
            return rec
    # fall back: token has exactly one admin record -> it covers the defendant
    cands = [rec for rec in ADMIN if row["token"] in rec["tokens"]]
    return cands[0] if len(cands) == 1 else None

ADMIN_FIELDS = ("settlement", "court", "claimsUrl", "administrator", "fund", "perClaimant",
                "classDefinition", "claimFormRequired", "importantDates", "whatToProvide",
                "documentsUrl", "notes")
admin_hits = 0
matched_recs = set()
for row in settlements:
    rec = admin_record_for(row)
    if not rec:
        row.setdefault("adminVerified", False)
        continue
    admin_hits += 1
    matched_recs.add(id(rec))
    row["adminVerified"] = bool(rec.get("adminVerified"))
    row["verifiedOn"]    = rec.get("verifiedOn")
    row["verified"]      = True
    row["windowType"]    = rec["windowType"]
    row["deadline"]      = (rec.get("importantDates") or {}).get("claimDeadline")
    row["name"]          = rec["settlement"][:120]
    for k in ADMIN_FIELDS:
        if rec.get(k) not in (None, ""):
            row[k] = rec[k]
print(f"admin-site overlay: {admin_hits} settlement rows matched a verified admin record")

# Admin records with no catalog row (e.g. the topclassactions full-category
# sweep) are first-class settlements in their own right — synthesize rows so
# they enter the registry instead of silently dropping.
synth = 0
for rec in ADMIN:
    if id(rec) in matched_recs:
        continue
    for tok in rec["tokens"]:
        row = dict(token=tok, defendant=rec["tokens"][0], name=rec["settlement"][:120],
                   windowType=rec["windowType"],
                   deadline=(rec.get("importantDates") or {}).get("claimDeadline"),
                   verified=True, source="admin-sites",
                   adminVerified=bool(rec.get("adminVerified")), verifiedOn=rec.get("verifiedOn"))
        for k in ADMIN_FIELDS:
            if rec.get(k) not in (None, ""):
                row[k] = rec[k]
        settlements.append(row)
        synth += 1
print(f"admin-site synthesis: {synth} rows added from records with no catalog match")

# ── 1c. Date-aware expiry + per-token dedupe ─────────────────────────────────
# An open claim window whose deadline has passed is EXPIRED no matter what any
# catalog says — this is exactly the Leedeman/Midland failure mode.
for row in settlements:
    if row["windowType"] == "open_claim_window" and row.get("deadline"):
        if date.fromisoformat(row["deadline"]) < TODAY:
            row["windowType"] = "expired"

# The same settlement reaches a token from several catalogs (wave1 + wave2 +
# breach sweep). Collapse rows sharing (token, windowType, deadline), keeping
# the best-sourced row: admin-verified > verified > unverified, then the one
# carrying the most fields.
_best = {}
for row in settlements:
    key = (row["token"], row["windowType"], row.get("deadline"))
    cur = _best.get(key)
    rank = (row.get("adminVerified", False), row.get("verified", False), len(row))
    if cur is None or rank > (cur.get("adminVerified", False), cur.get("verified", False), len(cur)):
        _best[key] = row
settlements = list(_best.values())
print(f"after dedupe: {len(settlements)} settlement rows")

# ── 1d. Active MDLs (mdlupdate.com sweep) ───────────────────────────────────
# Federal MDLs whose recovery period is still open to new claimants
# (Actively Recruiting / Open - Limited). Keyed to the person-index tokens the
# defendants would appear under, so the registry can surface "active MDL —
# direct filing" as a recovery route alongside settlements and dockets.
MDL_TOKEN_MAP = {
    "MDL-3170": ["trans union", "transunion"],
    "MDL-3114": ["at t", "att"],
    "MDL-3073": ["t mobile", "tmobile"],
    "MDL-3108": ["change healthcare", "unitedhealth"],
    "MDL-2879": ["marriott"],
    "MDL-3098": ["23andme"],
    "MDL-3153": ["coinbase"],
    "MDL-2972": ["blackbaud"],
    "MDL-3083": ["moveit", "progress software"],
    "MDL-2904": ["american medical collection agency", "labcorp amca"],
    "MDL-3149": ["powerschool naviance"],
    "MDL-3126": ["snowflake"],
    "MDL-3084": ["uber"],
    "MDL-3080": ["eli lilly", "novo nordisk", "sanofi"],
    "MDL-3047": ["meta", "facebook", "tiktok", "snap"],
}
mdl_by_token = defaultdict(list)
try:
    _mdls = json.load(open(f"{ROOT}/data/settlements/active-mdls-2026-06.json"))["mdls"]
    for m in _mdls:
        if not m.get("joinable"):
            continue
        toks = MDL_TOKEN_MAP.get(m["mdl"]) or [canonical_token(re.sub(r"(,? (Inc|LLC|Corp)\.?)|( Litigation.*$)", "", m["name"] or ""))]
        for t in toks:
            if t:
                mdl_by_token[t].append({k: m[k] for k in ("mdl", "name", "status", "pendingActions", "court", "url")})
    print(f"active MDLs: {sum(len(v) for v in mdl_by_token.values())} joinable rows across {len(mdl_by_token)} tokens")
except FileNotFoundError:
    print("active-mdls catalog not found — skipping MDL overlay")

# ── 2. Joinable / open litigation per token ──────────────────────────────────
open_class = defaultdict(int)   # class-screened open candidates (41-defendant set)
for c in json.load(open(f"{ROOT}/data/pacer-cases/_candidates.json")):
    if c.get("status") == "open":
        for d in c.get("matchedDefendants", []):
            tok = canonical_token(d)
            if tok:
                open_class[tok] += 1

# Open NOS 480/371/490 dockets per defendant, keyed by the SAME canonical
# token the casepeople person indexes use — parse the defendant side of every
# national-index title directly so the join is exact (the Top-1000 needle
# matcher missed spellings like "Navy FCU" vs "Navy Federal Credit Union").
open_dockets = defaultdict(int)
cand_pool    = defaultdict(int)
VS_RX = re.compile(r"\s+v[s]?\.?\s+", re.I)

# Same legal entity, different canonical tokens between case captions and the
# creditor strings the person indexes were built from. Each caption token also
# credits its sibling person-index tokens (both spellings hold people).
TOKEN_BRIDGES = {
    "usaa federal savings bank": ["usaa savings bank"],
    "usaa federal saving bank":  ["usaa savings bank", "usaa federal savings bank"],
    "loandepot com":             ["loan depot"],
}
def bridge_tokens(tok):
    return [tok] + TOKEN_BRIDGES.get(tok, [])

def title_token(title):
    t = re.sub(r"<[^>]*>", " ", str(title or ""))
    parts = VS_RX.split(t, maxsplit=1)
    if len(parts) < 2:
        return None
    return canonical_token(re.sub(r"\bet\s+al\.?", " ", parts[1]))

def _ran_18mo(c):
    f, e = c.get("dateFiled") or "", c.get("dateClosed") or TODAY.isoformat()
    return bool(f) and (date.fromisoformat(e[:10]) - date.fromisoformat(f[:10])).days > 548

for c in json.load(open(f"{ROOT}/data/pacer-cases/_national_consumer_index.json")):
    raw_tok = title_token(c.get("caseTitle"))
    if not raw_tok:
        continue
    for tok in bridge_tokens(raw_tok):
        if c.get("status") == "open":
            open_dockets[tok] += 1
            cand_pool[tok] += 1
        elif _ran_18mo(c):
            cand_pool[tok] += 1

tcpa_open = defaultdict(int)
VS_RX = re.compile(r"\s+v[s]?\.?\s+", re.I)
for c in json.load(open(f"{ROOT}/data/pacer-cases/_tcpa_index.json")):
    if c.get("status") != "open":
        continue
    t = re.sub(r"<[^>]*>", " ", str(c.get("caseTitle") or ""))
    parts = VS_RX.split(t, maxsplit=1)
    if len(parts) < 2:
        continue
    tok = canonical_token(re.sub(r"\bet\s+al\.?", " ", parts[1]))
    if tok:
        tcpa_open[tok] += 1

# ── 3. Assemble registry ─────────────────────────────────────────────────────
# Person-side tokens first, so the registry always covers every defendant the
# people are actually matched to (exact-join requirement of the audit).
print("Scanning casepeople tokens ...")
cp_keys = kv_scan_keys("casepeople:*")
by_tok = defaultdict(list)
for k in cp_keys:
    m = re.match(r"casepeople:(.+):(\d+)$", k)
    if m:
        by_tok[m.group(1)].append(k)

all_tokens = ({s["token"] for s in settlements} | set(open_class) | set(by_tok)
              | set(mdl_by_token)
              | {t for t, n in open_dockets.items() if n >= 3}
              | {t for t, n in tcpa_open.items() if n >= 3})
LIVE = {"open_claim_window", "automatic_payment", "rolling"}
# Everything the UI needs to mirror the administrator site for each window.
LIVE_FIELDS = ("name", "windowType", "deadline", "verified", "source", "adminVerified",
               "verifiedOn", "claimsUrl", "administrator", "fund", "perClaimant",
               "classDefinition", "claimFormRequired", "importantDates", "whatToProvide",
               "documentsUrl", "court", "notes")
# Filing windows first (soonest deadline up), then rolling sign-ups, then
# automatic payments where there is nothing to file.
WT_ORDER = {"open_claim_window": 0, "rolling": 1, "automatic_payment": 2}
registry = {}
for tok in sorted(all_tokens):
    setts = [s for s in settlements if s["token"] == tok]
    live  = sorted([s for s in setts if s["windowType"] in LIVE],
                   key=lambda s: (WT_ORDER.get(s["windowType"], 9), s.get("deadline") or "9999"))
    mon   = [s for s in setts if s["windowType"] == "monitor"]
    oc, od, tc = open_class.get(tok, 0), open_dockets.get(tok, 0), tcpa_open.get(tok, 0)
    if live:
        status = "claim_window"
    elif oc or od or tc:
        status = "joinable_litigation"
    elif mon:
        status = "monitor_only"
    else:
        status = "none"
    entry = dict(
        status=status,
        liveSettlements=[{k: s[k] for k in LIVE_FIELDS if k in s} for s in live][:6],
        monitorSettlements=[s["name"] for s in mon][:4],
        expiredSettlements=[s["name"] for s in setts if s["windowType"] == "expired"][:4],
        openClassCandidates=oc, openDockets=od, tcpaOpenDockets=tc,
    )
    if mdl_by_token.get(tok):
        entry["activeMdls"] = mdl_by_token[tok][:3]
        if entry["status"] == "none":
            entry["status"] = "joinable_litigation"
    registry[tok] = entry

# Case-type-level paths that exist regardless of the specific defendant.
CASETYPE_PATHS = {
    "DischargeViolation": {"path": "originate", "note": "Contempt under 11 USC 524 - no SOL; always filable while violation continues"},
    "FCRA":               {"path": "originate_if_sol_live", "note": "Direct FCRA claim vs furnisher/bureau after dispute; bureaus also have a perpetual open class pool"},
    "FDCPA":              {"path": "originate_if_sol_live", "note": "1-yr SOL; live signals are filable; otherwise needs defendant-level class membership"},
    "DataBreach":         {"path": "claim_window_by_construction", "note": "Rederive v2 only tags DataBreach from OPEN settlement entity matches"},
}

out = {
    "_meta": {"built": TODAY.isoformat(), "tokens": len(registry),
              "statusCounts": {s: sum(1 for r in registry.values() if r["status"] == s)
                               for s in ("claim_window", "joinable_litigation", "monitor_only", "none")},
              "caseTypePaths": CASETYPE_PATHS},
    "registry": registry,
}
json.dump(out, open(f"{ROOT}/data/case-claim-paths.json", "w"), indent=1)
payload = json.dumps(out)
kv_pipeline([["SET", "case:claim_paths", payload]])
print(f"registry: {len(registry)} tokens -> data/case-claim-paths.json + KV case:claim_paths ({len(payload):,} bytes)")
print("status counts:", out["_meta"]["statusCounts"])

# ── 4. Coverage audit: people per token vs claim-path status ─────────────────
print(f"\nAuditing casepeople indexes ... ({len(by_tok)} tokens, {len(cp_keys)} shard keys)")

tok_people = {}
toks = list(by_tok)
for i in range(0, len(toks), 40):
    batch = toks[i:i + 40]
    cmds = []
    for t in batch:
        cmds.extend([["ZCARD", k] for k in by_tok[t]])
    res = kv_pipeline(cmds)
    j = 0
    for t in batch:
        n = 0
        for _ in by_tok[t]:
            n += res[j].get("result") or 0
            j += 1
        tok_people[t] = n

agg = defaultdict(lambda: [0, 0])   # status -> [tokens, person-slots]
unmatched_tokens = []
for t, n in tok_people.items():
    st = registry.get(t, {}).get("status", "none")
    agg[st][0] += 1
    agg[st][1] += n
    if st == "none" and n > 0:
        unmatched_tokens.append((n, t))

total_people = sum(tok_people.values())
print(f"\n{'PATH STATUS':<22} {'TOKENS':>7} {'PERSON-SLOTS':>13} {'%':>6}")
for st in ("claim_window", "joinable_litigation", "monitor_only", "none"):
    tk, pp = agg[st]
    print(f"{st:<22} {tk:>7} {pp:>13,} {pp/max(total_people,1):>6.1%}")
print(f"{'TOTAL':<22} {len(tok_people):>7} {total_people:>13,}")
print("(person-slots = sum of per-defendant index members; one person can hold several)")

unmatched_tokens.sort(reverse=True)
print("\nTop 25 tokens with people but NO live claim path:")
for n, t in unmatched_tokens[:25]:
    print(f"  {n:>9,}  {t}")

json.dump({"built": TODAY.isoformat(), "totalPersonSlots": total_people,
           "byStatus": {s: {"tokens": agg[s][0], "personSlots": agg[s][1]} for s in agg},
           "noPathTokens": [{"token": t, "people": n} for n, t in unmatched_tokens]},
          open(f"{ROOT}/data/claim-path-coverage-2026-06-10.json", "w"), indent=1)
print(f"\ncoverage report -> data/claim-path-coverage-2026-06-10.json")
