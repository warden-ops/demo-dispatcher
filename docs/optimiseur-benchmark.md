# Benchmark de l'optimiseur de tournées

Jeu synthétique, graine fixe : 300 appels, 14 techniciens sans zone, départ et retour au dépôt (1000 rue Cormier, Drummondville). Horizon du 2026-11-11 au 2026-11-17 (5 jours ouvrables). Quota de 60 préventifs par jour. Temps de route : haversine × 1,3 à 72 km/h, la même matrice pour les deux méthodes.

Les appels de Sault Ste. Marie, Wawa, Sept-Îles, Corner Brook et Tillsonburg ne peuvent pas revenir au dépôt entre 8 h et 17 h. L'ancienne heuristique les place quand même. L'optimiseur les sort de la journée et les groupe en voyages.

| | Heuristique (ville / région) | Optimiseur |
| --- | ---: | ---: |
| Appels placés sur une journée | 300 | 274 |
| …dont la journée finit à 17 h | 110 | 274 |
| Réactifs faisables servis | 20 / 20 | 20 / 20 |
| Réactifs faisables hors SLA | 0 | 0 |
| Appels hors rayon placés sur une journée | 10 | 0 |
| Voyages dédiés ou nuitées | 0 | 4 (10 appels) |
| Temps de route total | 719.0 h | 258.8 h |
| Temps de route des journées finissant à 17 h | 90.8 h | 258.8 h |
| Journées qui dépassent 17 h | 43 | 0 |
| Durée du calcul | 8 ms | 120 ms |

Voyages proposés, non posés au calendrier :

| Secteur | Type | Appels | Aller depuis Drummondville |
| --- | --- | ---: | ---: |
| Corner Brook | nuitée | 1 | 20.7 h |
| Sault Ste. Marie et Wawa | nuitée | 6 | 16.4 h |
| Tillsonburg | nuitée | 1 | 13.3 h |
| Sept-Îles | nuitée | 2 | 12.0 h |

Le calcul de 300 × 14 reste sous 3 s (120 ms ici, budget de recherche locale 900 ms).
