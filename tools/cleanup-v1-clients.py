#!/usr/bin/env python3
"""
One-off: delete stale v1 client:lex_* records left behind by the v2 rederive.

run_lex (tools/credit-rederive.py) overwrote matched people but never deleted
v1 records for people v2 found no signal on — ~422K client:lex_* records with
ingestSource "credit_com_blob_full" (fabricated TCPA/DataBreach caseTypes, no
SOL) survive in KV and pollute the casepeople indexes. This sweep SCANs
client:lex_*, checks ingestSource, and DELs the v1 stragglers plus their
credit_report:lex_* keys. After it completes, casepeople:* must be deleted and
build-case-index re-forced (it only ever ZADDs).
"""

import json, os, re, sys, time, threading, http.client, ssl
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

PROJECT = Path("/Users/stef/MDL Business")
KEEP_SOURCE = "credit_rederive_v2"
GET_BATCH = 200
THREADS = 32

def load_env():
    for fn in (".env.local", ".env"):
        p = PROJECT / fn
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r"^([^#=\s]+)\s*=\s*(.*)$", line)
                if m:
                    os.environ.setdefault(m.group(1), m.group(2).strip().strip("\"'"))

load_env()
KV_URL = os.environ.get("KV_REST_API_URL", "")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
if not KV_URL or not KV_TOKEN:
    print("ERROR: KV_REST_API_URL / KV_REST_API_TOKEN required")
    sys.exit(1)
HOST = KV_URL.split("//")[-1].split("/")[0]
CTX = ssl.create_default_context()
_tl = threading.local()

lock = threading.Lock()
checked = deleted = errors = 0

def pipe(cmds):
    body = json.dumps(cmds).encode()
    hdrs = {"Authorization": f"Bearer {KV_TOKEN}", "Content-Type": "application/json",
            "Content-Length": str(len(body)), "Connection": "keep-alive"}
    for attempt in range(4):
        try:
            c = getattr(_tl, "c", None)
            if c is None:
                c = http.client.HTTPSConnection(HOST, context=CTX, timeout=40)
                _tl.c = c
            c.request("POST", "/pipeline", body=body, headers=hdrs)
            r = c.getresponse()
            raw = r.read()
            if r.status != 200:
                raise RuntimeError(f"http {r.status}")
            return json.loads(raw)
        except Exception:
            _tl.c = None
            if attempt == 3:
                raise
            time.sleep(0.5 * (attempt + 1))

def process(keys):
    global checked, deleted, errors
    try:
        res = pipe([["GET", k] for k in keys])
        dels = []
        for k, r in zip(keys, res):
            v = r.get("result")
            if not v:
                continue
            try:
                src = json.loads(v).get("ingestSource")
            except Exception:
                src = None
            if src != KEEP_SOURCE:
                pid = k.split(":", 1)[1]
                dels.append(["DEL", k])
                dels.append(["DEL", f"credit_report:{pid}"])
        if dels:
            pipe(dels)
        with lock:
            checked += len(keys)
            deleted += len(dels) // 2
    except Exception as e:
        with lock:
            errors += 1
            checked += len(keys)
        print(f"\n  batch error: {e}", flush=True)

def main():
    t0 = time.time()
    pool = ThreadPoolExecutor(max_workers=THREADS)
    futs = []
    cursor = "0"
    scanned = 0
    while True:
        res = pipe([["SCAN", cursor, "MATCH", "client:lex_*", "COUNT", "5000"]])
        cursor, batch = res[0]["result"]
        scanned += len(batch)
        for i in range(0, len(batch), GET_BATCH):
            futs.append(pool.submit(process, batch[i:i + GET_BATCH]))
        if len(futs) > THREADS * 8:
            futs = [f for f in futs if not f.done()]
        print(f"\r  scanned={scanned:,} checked={checked:,} deleted={deleted:,} "
              f"errors={errors} {scanned / max(1e-9, time.time() - t0):,.0f}/s",
              end="", flush=True)
        if cursor == "0":
            break
    pool.shutdown(wait=True)
    print()
    print(f"DONE: scanned={scanned:,} checked={checked:,} deleted={deleted:,} errors={errors}")

if __name__ == "__main__":
    main()
