# Canonical defendant normalization — Python mirror of api/_lib/defendantToken.js.
# SINGLE SOURCE OF TRUTH for the casepeople:<token> join key. Keep the ALIASES
# list in sync with the JS module verbatim when adding entries.

import re

# (needle_uppercased, canonical_token). If a raw string CONTAINS the needle it
# collapses to the token. Order matters — more specific needles first.
ALIASES = [
    # Debt buyers / collectors (FDCPA)
    ("MIDLAND FUNDING", "midland funding"),
    ("MIDLAND CREDIT", "midland credit management"),
    ("MCM", "midland credit management"),
    # bare "MIDLAND" omitted — collides with Midland States Bank / Midland Mortgage
    ("PORTFOLIO RECOV", "portfolio recovery associates"),
    ("LVNV", "lvnv funding"),
    ("RESURGENT", "resurgent capital"),
    ("ENCORE CAPITAL", "encore capital"),
    ("CAVALRY", "cavalry portfolio services"),
    ("ENHANCED RECOVERY", "enhanced recovery company"),
    ("ERC ", "enhanced recovery company"),
    ("TRANSWORLD", "transworld systems"),
    ("I.C. SYSTEM", "ic system"),
    ("IC SYSTEM", "ic system"),
    ("CONVERGENT", "convergent outsourcing"),
    ("JEFFERSON CAPITAL", "jefferson capital systems"),
    ("DIVERSIFIED CONSULT", "diversified consultants"),
    ("CREDIT COLLECTION SERV", "credit collection services"),
    ("NATIONAL CREDIT ADJUST", "national credit adjusters"),
    ("COMMONWEALTH FINANCIAL", "commonwealth financial systems"),
    ("WAKEFIELD", "wakefield associates"),
    ("MEDICAL DATA SYS", "medical data systems"),
    ("CAINE", "caine weiner"),
    ("AD ASTRA", "ad astra recovery services"),
    ("AMERICOLLECT", "americollect"),
    ("ACCOUNT RESOLUTION", "account resolution services"),
    ("UNITED REVENUE", "united revenue corp"),
    ("CONVERGYS", "convergent outsourcing"),
    ("RADIUS GLOBAL", "radius global solutions"),
    ("CBE GROUP", "cbe group"),
    ("AMSHER", "amsher collection"),
    ("NCO FINANCIAL", "nco financial"),
    ("HUNTER WARFIELD", "hunter warfield"),
    ("SHERMAN", "sherman financial"),
    ("CACH", "cach llc"),
    ("CCO ", "cco mortgage"),
    # Subprime auto lenders
    ("CREDIT ACCEPTANCE", "credit acceptance"),
    ("SANTANDER", "santander consumer usa"),
    ("WESTLAKE", "westlake financial"),
    ("EXETER", "exeter finance"),
    ("DRIVETIME", "drivetime"),
    ("CONSUMER PORTFOLIO SERV", "consumer portfolio services"),
    ("AMERICAN CREDIT ACCEPT", "american credit acceptance"),
    ("BYRIDER", "jd byrider"),
    ("TOYOTA", "toyota motor credit"),
    ("NISSAN", "nissan motor acceptance"),
    ("AMERICAN HONDA", "american honda finance"),
    ("HONDA FIN", "american honda finance"),
    ("GM FINANCIAL", "gm financial"),
    ("CHRYSLER CAPITAL", "chrysler capital"),
    ("FORD MOTOR CREDIT", "ford motor credit"),
    ("ALLY", "ally financial"),
    # Installment / payday / subprime cards (UDAP)
    ("ONEMAIN", "onemain financial"),
    ("ONE MAIN", "onemain financial"),
    ("MARINER", "mariner finance"),
    ("LENDMARK", "lendmark financial"),
    ("WORLD FINANCE", "world acceptance"),
    ("WORLD ACCEPTANCE", "world acceptance"),
    ("REGIONAL MANAGE", "regional management"),
    ("REPUBLIC FINANCE", "republic finance"),
    ("HEIGHTS FINANCE", "heights finance"),
    ("SPRINGLEAF", "onemain financial"),
    ("TITLEMAX", "titlemax"),
    ("LOANMAX", "titlemax"),
    ("ADVANCE AMERICA", "advance america"),
    ("SPEEDY CASH", "speedy cash"),
    ("ACE CASH", "ace cash express"),
    ("CHECK INTO CASH", "check into cash"),
    ("FIRST CASH", "first cash"),
    # Bank / card furnishers
    ("CAPITAL ONE", "capital one"),
    ("CAP ONE", "capital one"),
    ("COAF", "capital one"),
    ("KOHLS", "capital one"),
    ("SYNCHRONY", "synchrony"),
    ("SYNCB", "synchrony"),
    ("COMENITY", "comenity"),
    ("CREDIT ONE", "credit one bank"),
    ("FIRST PREMIER", "first premier bank"),
    ("MERRICK", "merrick bank"),
    ("MISSION LANE", "mission lane"),
    ("MILESTONE", "milestone genesis"),
    ("GENESIS FS", "milestone genesis"),
    ("FORTIVA", "fortiva"),
    ("DISCOVER", "discover"),
    ("SYNOVUS", "synovus"),
    ("CITIBANK", "citibank"),
    ("CITI ", "citibank"),
    ("WELLS FARGO", "wells fargo"),
    ("BANK OF AMERICA", "bank of america"),
    ("JPMORGAN", "chase"),
    ("JP MORGAN", "chase"),
    ("CHASE", "chase"),
    ("AMERICAN EXPRESS", "american express"),
    ("AMEX", "american express"),
    # Student loan servicers
    ("NAVIENT", "navient"),
    ("SALLIE MAE", "sallie mae"),
    ("GREAT LAKES", "great lakes"),
    ("FEDLOAN", "fedloan"),
    ("MOHELA", "mohela"),
    ("NELNET", "nelnet"),
    ("AIDVANTAGE", "aidvantage"),
    ("EDFINANCIAL", "edfinancial"),
    ("PHEAA", "pheaa"),
    # Mortgage servicers (RESPA)
    ("OCWEN", "ocwen"),
    ("PHH MORTGAGE", "phh mortgage"),
    ("NATIONSTAR", "mr cooper"),
    ("MR. COOPER", "mr cooper"),
    ("MR COOPER", "mr cooper"),
    ("DITECH", "ditech"),
    ("GREEN TREE", "ditech"),
    ("GREENTREE", "ditech"),
    ("CALIBER HOME", "caliber home loans"),
    ("SHELLPOINT", "shellpoint"),
    ("NEWREZ", "newrez"),
    ("SPECIALIZED LOAN", "specialized loan servicing"),
    ("CENLAR", "cenlar"),
    ("SELECT PORTFOLIO", "select portfolio servicing"),
    ("RUSHMORE", "rushmore"),
    ("ROUNDPOINT", "roundpoint"),
]

_SUFFIX_RE = re.compile(r"\b(INC|LLC|CORP|CORPORATION|CO|LTD|LP|LLP|PLLC|PC|N\s*A|SVC|SVCS)\b")
_NONALNUM_RE = re.compile(r"[^A-Z0-9 ]")
_WS_RE = re.compile(r"\s+")


def norm_def(s):
    up = str(s or "").upper()
    up = re.sub(r"[.,'\"]", " ", up).replace("&", " ")
    up = _SUFFIX_RE.sub(" ", up)
    up = _NONALNUM_RE.sub(" ", up)
    return _WS_RE.sub(" ", up).strip()


def canonical_token(name):
    if not name:
        return ""
    up = str(name).upper()
    for needle, token in ALIASES:
        if needle in up:
            return token
    return norm_def(name).lower()
