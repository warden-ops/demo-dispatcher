# Benchmark de l'optimiseur de tournées

Jeu synthétique, graine fixe : 300 appels, 14 techniciens sans zone, départ et retour au dépôt (1000 rue Cormier, Drummondville). Horizon du 2026-11-11 au 2026-11-17 (5 jours ouvrables). Quota de 60 préventifs par jour. Temps de route : repli autoroute (court trajet lent, long trajet ~100 km/h), la même matrice pour les deux méthodes.

Les appels de Sault Ste. Marie, Wawa, Sept-Îles, Corner Brook et Tillsonburg ne peuvent pas revenir au dépôt entre 8 h et 17 h. L'ancienne heuristique les place quand même. L'optimiseur les sort de la journée et les groupe en voyages.

| | Heuristique (ville / région) | Optimiseur |
| --- | ---: | ---: |
| Appels placés sur une journée | 300 | 285 |
| …dont la journée finit à 17 h | 75 | 285 |
| Réactifs faisables servis | 20 / 20 | 20 / 20 |
| Réactifs faisables hors SLA | 0 | 0 |
| Appels hors rayon placés sur une journée | 10 | 0 |
| Voyages dédiés ou nuitées | 0 | 4 (10 appels) |
| Temps de route total | 566.3 h | 273.4 h |
| Temps de route des journées finissant à 17 h | 67.9 h | 273.4 h |
| Journées qui dépassent 17 h | 52 | 0 |
| Durée du calcul | 10 ms | 150 ms |

Voyages proposés, non posés au calendrier :

| Secteur | Type | Appels | Aller depuis Drummondville |
| --- | --- | ---: | ---: |
| Corner Brook | nuitée | 1 | 12.4 h |
| Sault Ste. Marie et Wawa | nuitée | 6 | 9.8 h |
| Tillsonburg | nuitée | 1 | 7.9 h |
| Sept-Îles | nuitée | 2 | 7.2 h |

Le calcul de 300 × 14 reste sous 3 s (150 ms ici, budget de recherche locale 900 ms).

## Échantillon façon production

Même optimiseur, deux matrices. « Avant » : vol d'oiseau × 1,3 à 72 km/h (le repli qui envoyait Ottawa en nuitée). « Après » : repli autoroute. 4 techniciens sans zone, horizon 5 jours, quota 40. Comprend Ottawa/Gatineau, Baie-Saint-Paul, Rivière-du-Loup, Saguenay, des rendez-vous fixes et Sault Ste. Marie.

| | Avant (72 km/h) | Après (autoroute) |
| --- | --- | --- |
| Appels placés | 6 | 42 |
| Non placés | 0 | 0 |
| Raisons | — | — |
| Voyages nuitée / dédiés | 3 (38 appels) | 1 (2 appels) |
| Secteurs en voyage | Sault Ste. Marie et Wawa, Gatineau et Ottawa, Baie-Saint-Paul, Rivière-du-Loup et Saguenay | Sault Ste. Marie et Wawa |
| Heures de route | 18.4 h | 95.4 h |
| Fin la plus tardive | 17.7 h | 17.7 h |

Les rendez-vous fixes (Saint-Jean 8 h et 9 h, Ange-Gardien 13 h, Val-David 13 h 45, Saint-Hyacinthe 15 h 30) et Saint-Anselme sans heure sont dans les appels placés de la colonne Après. Sault Ste. Marie et Wawa restent un voyage, parce que l'aller-retour ne rentre pas dans la journée. Une adresse sans ville ni code postal connu reste « Adresse à valider » avant le solveur (hors de ce tableau).

