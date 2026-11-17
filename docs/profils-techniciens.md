# Profils techniciens et durées (NetSuite)

Source : NetSuite prod, **lecture seule** (SuiteQL), le 2026-11-17. Tâches `COMPLETE` liées à un cas, type de tâche « Sur place » (`custevent_nx_task_type = 3`).

## Ce qui est utilisé par l'optimiseur

| Donnée | Résultat | Utilisation |
| --- | --- | --- |
| Adresse de départ | Aucune adresse d'employé dans NetSuite (1 seule dans tout le compte, pas un tech). L'emplacement NetSuite est un camion ou « Entrepôt ». | Départ inchangé : 1000 rue Cormier. |
| Durées sur place | Blocs planifiés (début → fin de tâche), 12 mois. Préventif : médiane 60 min (n = 1 040, p25 45, p75 120). Réactif : médiane 120 min (n = 8 492, p25 75, p75 120). Pas de différence nette par type d'appareil (réactif 120 partout ; préventif Espresso et café filtre 75). | Durées par défaut : 60 / 120 (avant : 60 / 90). Le répartiteur peut les changer. |
| Rôle | Atelier si les tâches atelier (`task_type = 5`) dépassent les visites sur place. | Atelier et compte en double : pas de tournée route (case à cocher pour les inclure). Un rendez-vous déjà attribué reste au technicien. |
| Secteurs habituels | Visites sur place des 6 derniers mois, regroupées à 50 km ; secteur gardé s'il pèse au moins 8 % et 8 visites. | Pénalité douce : 0 dans le secteur (rayon + 15 km), puis 10 min + 0,3 min/km, plafond 60 min. Jamais une interdiction. |

## Limites

- Les durées sont des **blocs planifiés**, pas des temps pointés. Les enregistrements de temps (`timebill`, time logs NextService) et les lignes de transaction ne sont pas accessibles au rôle d'intégration. 62 % des réactifs ont exactement 120 min, la valeur par défaut de la prise de rendez-vous.
- Les adresses de domicile des techniciens doivent venir de Guertech.
- Les comptes génériques « Technicien Guertech » et « Technicien Laval » font une grande part des visites (sous-traitance ou compte partagé) et ne sont pas parmi les 14 techniciens.

## Régénérer

```bash
NETSUITE_ACCOUNT_ID=... NETSUITE_CONSUMER_KEY=... NETSUITE_CONSUMER_SECRET=... \
NETSUITE_TOKEN_ID=... NETSUITE_TOKEN_SECRET=... \
python3 scripts/netsuite-tech-profiles.py 355464 280871 ... > src/lib/guertech/tech-profiles.data.ts
```
