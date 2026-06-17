#!/usr/bin/env python3
"""
Targeted KV correction (the "display-honest + dedup" pass the user approved).

Two independent corrections, both dry-run by default:

  --stats   Fix credit_portfolio:stats — replace the fabricated §524 figures
            (byCaseType.DischargeViolation 3,865,163 -> 567,266 corrected
            qualifying signals; bySolStatus.discharge_ongoing -> 41,629 live,
            add discharge_stale 525,637) + a correction note. Old values backed
            up to corrections/stats_backup.json. 1 KV write.

  --dedup   Suppress lex_ twins of CCOM people (corrections/dedup_suppress.csv):
            set suppressed=true + supersededBy on the lex_ record and ZREM it
            from by_score:{shard} so it stops double-counting. Skips any twin
            whose cc_ survivor is not actually in KV. Idempotent, checkpointed.

Nothing writes unless --apply is passed. Use --limit N to sample (dedup).
  /usr/bin/python3 tools/credit-kv-correct.py --stats --dedup            # dry-run
  /usr/bin/python3 tools/credit-kv-correct.py --dedup --limit 10000      # sample dry-run
  /usr/bin/python3 tools/credit-kv-correct.py --stats --dedup --apply    # real
"""
import os, sys, csv, json, argparse, urllib.request, time
from pathlib import Path

CORR = Path("/Users/stef/credit-data-src/corrections")
N_SHARDS = 16
# Corrected §524 figures (from tools/credit-correction-export.py + signal compute)
S524_SIGNALS_CANON = 567266
S524_LIVE_SIGNALS  = 41629
S524_STALE_SIGNALS = S524_SIGNALS_CANON - S524_LIVE_SIGNALS  # 525,637
S524_PEOPLE        = 207357
S524_LIVE_PEOPLE   = 12989


def load_env():
    for line in (Path(__file__).parent.parent / ".env.local").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def shard_of(pid):  # MUST match tools/credit-rederive.py:shard_of
    h = 0
    for ch in pid:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % N_SHARDS


URL = TOK = None
def pipeline(cmds):
    """POST a batch of commands to the Upstash pipeline endpoint."""
    req = urllib.request.Request(f"{URL}/pipeline", data=json.dumps(cmds).encode(),
                                 headers={"Authorization": f"Bearer {TOK}",
                                          "Content-Type": "application/json"})
    out = json.load(urllib.request.urlopen(req))
    return [r.get("result") if isinstance(r, dict) else r for r in out]


# ---- stats correction --------------------------------------------------------
def fix_stats(apply):
    cur = pipeline([["GET", "credit_portfolio:stats"]])[0]
    s = json.loads(cur)
    bc, bs = s.get("byCaseType", {}), s.get("bySolStatus", {})
    backup = {"byCaseType.DischargeViolation": bc.get("DischargeViolation"),
              "bySolStatus.discharge_ongoing": bs.get("discharge_ongoing"),
              "note": s.get("note")}
    print("\n=== STATS FIX (credit_portfolio:stats) ===")
    print(f"  byCaseType.DischargeViolation : {bc.get('DischargeViolation'):>10,} -> {S524_SIGNALS_CANON:>10,}")
    print(f"  bySolStatus.discharge_ongoing: {bs.get('discharge_ongoing'):>10,} -> {S524_LIVE_SIGNALS:>10,}")
    print(f"  bySolStatus.discharge_stale  : {'(none)':>10} -> {S524_STALE_SIGNALS:>10,}  (new)")
    if not apply:
        print("  [dry-run] not written")
        return
    CORR.mkdir(exist_ok=True)
    (CORR / "stats_backup.json").write_text(json.dumps(backup, indent=2))
    bc["DischargeViolation"] = S524_SIGNALS_CANON
    bs["discharge_ongoing"] = S524_LIVE_SIGNALS
    bs["discharge_stale"] = S524_STALE_SIGNALS
    s["note"] = ((s.get("note") or "") +
                 f" §524 corrected 2026-06-17: {S524_PEOPLE:,} people / {S524_SIGNALS_CANON:,} "
                 f"qualifying signals ({S524_LIVE_PEOPLE:,} live people); prior figures were "
                 f"inflated by an MMYY parse bug + missing pre-petition check.").strip()
    s["byCaseType"], s["bySolStatus"] = bc, bs
    r = pipeline([["SET", "credit_portfolio:stats", json.dumps(s)]])[0]
    print(f"  WRITTEN (backup at {CORR/'stats_backup.json'}): {r}")


# ---- dedup suppression -------------------------------------------------------
def fix_dedup(apply, limit):
    rows = list(csv.DictReader(open(CORR / "dedup_suppress.csv")))
    if limit:
        rows = rows[:limit]
    print(f"\n=== DEDUP SUPPRESSION ({len(rows):,} candidate lex_ twins{' [SAMPLE]' if limit else ''}) ===")
    ck = CORR / "dedup_checkpoint.json"
    start = json.loads(ck.read_text())["next"] if (apply and ck.exists()) else 0
    tally = dict(lex_missing=0, cc_missing=0, already=0, suppressed=0)
    B = 256
    for i in range(start, len(rows), B):
        batch = rows[i:i + B]
        got = pipeline([["GET", f"client:lex_{r['lex_uid']}"] for r in batch])
        cc_got = pipeline([["GET", f"client:cc_{r['survivor_ccom_ucid']}"] for r in batch])
        writes = []
        for r, lx, cc in zip(batch, got, cc_got):
            if not lx: tally["lex_missing"] += 1; continue
            if not cc: tally["cc_missing"] += 1; continue
            d = json.loads(lx)
            if d.get("suppressed"): tally["already"] += 1; continue
            tally["suppressed"] += 1
            if apply:
                d["suppressed"] = True
                d["supersededBy"] = f"cc_{r['survivor_ccom_ucid']}"
                pid = f"lex_{r['lex_uid']}"
                writes += [["SET", f"client:{pid}", json.dumps(d)],
                           ["ZREM", f"by_score:{shard_of(pid)}", pid]]
        if apply and writes:
            res = pipeline(writes)
            fails = [w for w, rr in zip(writes, res) if rr is None and w[0] == "SET"]
            if fails:
                (CORR / "dedup_deadletter.txt").open("a").write("\n".join(w[1] for w in fails) + "\n")
            ck.write_text(json.dumps({"next": i + B}))
        if (i // B) % 20 == 0:
            print(f"  ...{i+len(batch):,}/{len(rows):,}  suppressed={tally['suppressed']:,} "
                  f"cc_missing={tally['cc_missing']:,} lex_missing={tally['lex_missing']:,}", flush=True)
    print(f"  RESULT: would-suppress={tally['suppressed']:,}  already={tally['already']:,}  "
          f"cc_missing={tally['cc_missing']:,}  lex_missing={tally['lex_missing']:,}")
    if apply:
        ck.unlink(missing_ok=True)
        print("  APPLIED.")
    else:
        print("  [dry-run] no writes")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--dedup", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if not (a.stats or a.dedup):
        ap.error("pass --stats and/or --dedup")
    load_env()
    global URL, TOK
    URL, TOK = os.environ["KV_REST_API_URL"], os.environ["KV_REST_API_TOKEN"]
    print(f"MODE: {'APPLY (writes)' if a.apply else 'DRY-RUN (no writes)'}")
    if a.stats: fix_stats(a.apply)
    if a.dedup: fix_dedup(a.apply, a.limit)


if __name__ == "__main__":
    main()
