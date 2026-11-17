#!/usr/bin/env python3
"""Régénère src/lib/guertech/tech-profiles.data.ts à partir de NetSuite (lecture seule).

Lit uniquement des variables d'environnement (jamais de secret dans le dépôt) :
  NETSUITE_ACCOUNT_ID, NETSUITE_CONSUMER_KEY, NETSUITE_CONSUMER_SECRET,
  NETSUITE_TOKEN_ID, NETSUITE_TOKEN_SECRET
SuiteQL seulement (SELECT). Aucune écriture.

Usage : python3 scripts/netsuite-tech-profiles.py 355464 280871 ... > /tmp/out.ts
"""
import base64, collections, hashlib, hmac, json, math, os, re, secrets, statistics as S, sys, time
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta

# Rôles sans historique suffisant, fixés à la main (titre NetSuite « atelier » ou compte en double).
ROLE_OVERRIDES = {"11": "doublon", "454017": "atelier", "472844": "atelier"}
q = lambda s: urllib.parse.quote(str(s), safe="~")


def suiteql(sql, limit=1000):
    acct = os.environ["NETSUITE_ACCOUNT_ID"]
    host = acct.lower().replace("_", "-") + ".suitetalk.api.netsuite.com"
    url = f"https://{host}/services/rest/query/v1/suiteql"
    out, offset = [], 0
    while True:
        params = {"limit": limit, "offset": offset}
        oa = {
            "oauth_consumer_key": os.environ["NETSUITE_CONSUMER_KEY"],
            "oauth_token": os.environ["NETSUITE_TOKEN_ID"],
            "oauth_signature_method": "HMAC-SHA256",
            "oauth_timestamp": str(int(time.time())),
            "oauth_nonce": secrets.token_hex(12),
            "oauth_version": "1.0",
        }
        base_params = "&".join(f"{q(k)}={q(v)}" for k, v in sorted({**oa, **params}.items()))
        base = "&".join(["POST", q(url), q(base_params)])
        key = f"{q(os.environ['NETSUITE_CONSUMER_SECRET'])}&{q(os.environ['NETSUITE_TOKEN_SECRET'])}"
        oa["oauth_signature"] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha256).digest()).decode()
        auth = f'OAuth realm="{acct.upper().replace("-", "_")}",' + ",".join(f'{k}="{q(v)}"' for k, v in oa.items())
        req = urllib.request.Request(
            url + "?" + urllib.parse.urlencode(params),
            method="POST",
            data=json.dumps({"q": sql}).encode(),
            headers={"Authorization": auth, "Content-Type": "application/json", "Prefer": "transient"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        out += data.get("items", [])
        if not data.get("hasMore"):
            return out
        offset += limit


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def city(addr):
    for line in reversed([l.strip() for l in (addr or "").replace("\r", "").split("\n") if l.strip()]):
        m = re.match(r"^(.*?)\s+(QC|ON|NB|NS|PE|NL|AB|MB|SK|BC)\b", line)
        if m:
            return m.group(1).strip().title()
    return None


def minutes(row):
    try:
        a = datetime.strptime(row["st"], "%Y-%m-%d %H:%M")
        b = datetime.strptime(row["et"], "%Y-%m-%d %H:%M")
        return (b - a).total_seconds() / 60
    except (KeyError, TypeError, ValueError):
        return None


def main(tech_ids):
    since12 = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
    since6 = (datetime.now() - timedelta(days=183)).strftime("%Y-%m-%d")
    rows = suiteql(f"""select t.assigned, TO_CHAR(t.starttime,'YYYY-MM-DD HH24:MI') st, TO_CHAR(t.endtime,'YYYY-MM-DD HH24:MI') et,
      t.custevent_nx_address addr, t.custevent_nx_latitude lat, t.custevent_nx_longitude lng,
      t.custevent_nx_task_type tt, c.custevent_nx_case_type ct
      from task t join supportcase c on c.id=t.supportcase
      where t.status='COMPLETE' and t.starttime >= TO_DATE('{since12}','YYYY-MM-DD')""")
    onsite = [r for r in rows if r.get("tt") == "3"]
    med = {}
    for code, name in (("6", "preventif"), ("7", "reactif")):
        v = [m for m in (minutes(r) for r in onsite if r.get("ct") == code) if m and 0 < m <= 600]
        qs = S.quantiles(v, n=4)
        med[name] = (int(S.median(v)), len(v), int(qs[0]), int(qs[2]))
    profiles = {}
    for tid in tech_ids:
        mine = [r for r in rows if r.get("assigned") == tid]
        shop = sum(1 for r in mine if r.get("tt") == "5")
        visits = sum(1 for r in mine if r.get("tt") == "3")
        role = ROLE_OVERRIDES.get(tid) or ("atelier" if shop > visits else "route")
        pts = [(float(r["lat"]), float(r["lng"]), city(r.get("addr"))) for r in mine
               if r.get("tt") == "3" and r.get("lat") and r.get("lng") and (r.get("st") or "") >= since6]
        clusters = []
        for lat, lng, c in sorted(pts):
            for cl in clusters:
                if hav((cl["lat"], cl["lng"]), (lat, lng)) <= 50:
                    cl["pts"].append((lat, lng, c)); n = len(cl["pts"])
                    cl["lat"] += (lat - cl["lat"]) / n; cl["lng"] += (lng - cl["lng"]) / n
                    break
            else:
                clusters.append({"lat": lat, "lng": lng, "pts": [(lat, lng, c)]})
        anchors = []
        for cl in sorted(clusters, key=lambda c: -len(c["pts"])):
            share = len(cl["pts"]) / len(pts)
            if share < 0.08 or len(cl["pts"]) < 8:
                continue
            names = collections.Counter(c for _, _, c in cl["pts"] if c)
            rad = sorted(hav((cl["lat"], cl["lng"]), (a, b)) for a, b, _ in cl["pts"])
            anchors.append((names.most_common(1)[0][0] if names else "?", round(cl["lat"], 3), round(cl["lng"], 3),
                            int(round(max(15, rad[int(len(rad) * 0.8)]))), round(share, 2)))
        profiles[tid] = (role, len(pts), anchors)
    print("// Généré par scripts/netsuite-tech-profiles.py (NetSuite, lecture seule).")
    print('export type TechZoneAnchor = {\n  label: string;\n  lat: number;\n  lng: number;\n  radiusKm: number;\n  share: number;\n};\n')
    print('export type TechRole = "route" | "atelier" | "doublon";\n')
    print("export type TechProfile = {\n  role: TechRole;\n  visits6m: number;\n  anchors: TechZoneAnchor[];\n};\n")
    print("export const TECH_PROFILES: Record<string, TechProfile> = {")
    for tid, (role, n, anchors) in profiles.items():
        print(f'  "{tid}": {{\n    role: "{role}",\n    visits6m: {n},')
        if not anchors:
            print("    anchors: [],")
        else:
            print("    anchors: [")
            for label, lat, lng, rad, share in anchors:
                print(f"      {{ label: {json.dumps(label, ensure_ascii=False)}, lat: {lat}, lng: {lng}, radiusKm: {rad}, share: {share} }},")
            print("    ],")
        print("  },")
    print("};\n")
    print("export const NETSUITE_DURATION_MEDIANS = {")
    for name, (m, n, p25, p75) in med.items():
        print(f"  {name}: {{ minutes: {m}, n: {n}, p25: {p25}, p75: {p75} }},")
    print("} as const;")


if __name__ == "__main__":
    main(sys.argv[1:])
