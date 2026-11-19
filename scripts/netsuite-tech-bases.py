#!/usr/bin/env python3
"""Régénère src/lib/guertech/tech-bases.data.ts : point de départ ESTIMÉ de chaque technicien.

NetSuite n'a aucune adresse de domicile pour les techniciens. On prend, sur les
4 derniers mois, le premier arrêt « Sur place » terminé de chaque journée (là où
le technicien est à 8 h) et on garde le médoïde de ces points (le premier arrêt
le plus central, distances plafonnées à 150 km). Si moins de 15 % des journées
commencent à 35 km ou moins de ce point, le technicien part du dépôt.

Variables d'environnement seulement (jamais de secret dans le dépôt), SuiteQL
SELECT seulement : NETSUITE_ACCOUNT_ID, NETSUITE_CONSUMER_KEY,
NETSUITE_CONSUMER_SECRET, NETSUITE_TOKEN_ID, NETSUITE_TOKEN_SECRET.

Usage : python3 scripts/netsuite-tech-bases.py 361184 259020 ... > src/lib/guertech/tech-bases.data.ts
"""
import importlib.util, json, os, sys
from datetime import datetime, timedelta

spec = importlib.util.spec_from_file_location("prof", os.path.join(os.path.dirname(__file__), "netsuite-tech-profiles.py"))
prof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prof)

MIN_SHARE = 0.15
NEAR_KM = 35
MIN_DAYS = 10


def main(ids):
    since = (datetime.now() - timedelta(days=122)).strftime("%Y-%m-%d")
    rows = prof.suiteql(f"""SELECT t.assigned AS tech, TO_CHAR(t.startdate,'YYYY-MM-DD') AS d, TO_CHAR(t.starttime,'HH24:MI') AS h,
      t.custevent_nx_latitude AS lat, t.custevent_nx_longitude AS lng, t.custevent_nx_address AS addr
      FROM task t WHERE t.status = 'COMPLETE' AND t.custevent_nx_task_type = 3 AND t.supportcase IS NOT NULL
      AND t.assigned IN ({','.join(str(int(i)) for i in ids)}) AND t.startdate >= TO_DATE('{since}','YYYY-MM-DD')""")
    first = {}
    for r in rows:
        if not r.get("lat") or not r.get("lng"): continue
        key = (r["tech"], r["d"])
        if key not in first or (r.get("h") or "99") < (first[key].get("h") or "99"):
            first[key] = r
    bases = {}
    for tech in ids:
        pts = [(float(r["lat"]), float(r["lng"]), prof.city(r.get("addr") or "")) for (t, _), r in first.items() if t == str(tech)]
        if len(pts) < MIN_DAYS: continue
        best = min(pts, key=lambda p: sum(min(prof.hav(p, q), 150) for q in pts))
        share = sum(1 for q in pts if prof.hav(best, q) <= NEAR_KM) / len(pts)
        if share < MIN_SHARE: continue
        bases[str(tech)] = {"label": best[2] or "Secteur habituel", "lat": round(best[0], 3), "lng": round(best[1], 3),
                            "days": len(pts), "share": round(share, 2)}
    print("// Généré par scripts/netsuite-tech-bases.py (NetSuite prod, lecture seule).")
    print("// Point de départ ESTIMÉ : aucun domicile dans NetSuite. À confirmer par Guertech.")
    print("export type TechBase = { label: string; lat: number; lng: number; days: number; share: number };")
    print()
    print("export const TECH_BASES: Record<string, TechBase> = " + json.dumps(bases, ensure_ascii=False, indent=2) + ";")


if __name__ == "__main__":
    main(sys.argv[1:])
