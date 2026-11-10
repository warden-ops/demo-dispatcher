# Dispatch v2 et le sandbox NetSuite

Dispatch v2 (`/dispatch-v2`) lit les appels de service et les techniciens dans le sandbox NetSuite `9394021_SB1` quand les variables TBA sont définies. Sans ces variables, la page garde le CSV de démo (`public/dispatch-v2/appels.csv`) et la liste de techniciens fictive. La démo Jordan Hale sur `/` n'est pas branchée.

Le sandbox reçoit une copie des appels de production environ toutes les 15 minutes. Ces copies portent un `externalId` qui commence par `PROD-CASE-` (cas) et `PROD-TASK-` (tâche).

## Modèle utilisé

NetSuite Field Service (ancien NextService).

- L'appel affiché est une `task` liée à un `supportcase` (`task.supportcase`).
- Types de cas lus : `custevent_nx_case_type` 6 (Maintenance, préventif) et 7 (Repair, réactif).
- Seulement les tâches `NOTSTART`, et seulement les cas qui ne sont pas 17 Terminé, 19 Annulé ou 20 Fermé.
- Le technicien est `task.assigned`. La date est `task.startdate`, l'heure `task.starttime`.
- L'adresse vient de `custevent_nx_address`. S'il n'y a pas de texte, la latitude et la longitude de la tâche servent de repli.
- Les techniciens sont les employés actifs des départements Technique, Technicien mobile et Atelier. Les files d'attente 35274 (Technicien Guertech) et 228238 (Technicien Laval) sont écartées.
- Les dates SuiteQL passent par `TO_CHAR(..., 'YYYY-MM-DD')` et `TO_CHAR(..., 'HH24:MI')`. Le compte affiche DD/MM/YYYY, l'API d'enregistrement accepte l'ISO.

`BUILTIN.DF()` est utilisé dans le SELECT seulement. Il n'est pas mis dans un GROUP BY.

## Variables

À poser dans l'environnement du processus (sur le VPS : `/var/www/demo-dispatcher/.env`, puis redémarrer `demo-dispatcher`). Aucune valeur n'est committée. `.env.example` reste vide.

| Variable | Rôle |
| --- | --- |
| `NETSUITE_ACCOUNT_ID` | Realm TBA, tel quel. Exemple de forme : `9394021_SB1`. |
| `NETSUITE_CONSUMER_KEY` | Consumer key du client TBA. |
| `NETSUITE_CONSUMER_SECRET` | Consumer secret. Serveur seulement. |
| `NETSUITE_TOKEN_ID` | Token id. |
| `NETSUITE_TOKEN_SECRET` | Token secret. Serveur seulement. |
| `NETSUITE_WRITE_ENABLED` | `true` pour autoriser `POST /api/netsuite/dispatch`. Toute autre valeur, y compris l'absence, bloque l'écriture. |

Le hôte REST est dérivé du compte : minuscules, `_` remplacé par `-`, puis `https://<compte>.suitetalk.api.netsuite.com`.

## Routes

Toutes en runtime Node.js. Les lectures passent par un cache mémoire de 60 secondes.

- `GET /api/netsuite/appels` : `{ demo: false, appels }` ou `{ demo: true }` si les variables manquent.
- `GET /api/netsuite/techs` : même principe, avec `techs`.
- `GET /api/netsuite/customers` et `GET /api/netsuite/items` : lectures SuiteQL paginées, sans lien avec l'écran de dispatch.
- `POST /api/netsuite/dispatch` : liste `[{ taskId, techId, date, heure?, status?, caseId?, caseStatus? }]`. Chaque tâche reçoit `assigned`, `startDate`, `dueDate` et un statut parmi `NOTSTART`, `PROGRESS`, `COMPLETE`. Si `caseId` et `caseStatus` sont fournis, le cas est aussi mis à jour (`1` = Reparti).

L'écran affiche « Données NetSuite (sandbox) » ou « Demo ». Le bouton « Envoyer à NetSuite » pousse les arrêts du calendrier. En mode démo, l'API refuse l'envoi.

## Tester sans identifiants

```bash
npm test
npm run lint
npm run build
```

Les tests couvrent le vecteur de signature OAuth (nonce et horodatage fixes), le mapping, le cache, la pagination mockée et le refus d'écriture. Ils n'appellent pas NetSuite.

Avec de vrais identifiants dans `.env.local` (jamais committé) :

```bash
npm run dev
```

Ouvrir `/dispatch-v2`. L'indicateur doit passer à « Données NetSuite (sandbox) ». `GET /api/netsuite/appels` doit renvoyer `demo: false`. Tant que `NETSUITE_WRITE_ENABLED` n'est pas `true`, le bouton d'envoi reçoit un 403.

## Limites connues

- Le filtre `externalid LIKE 'PROD-CASE-%'` et `PROD-TASK-%` suppose que la copie 15 minutes remplit ces deux champs. Sinon la liste d'appels reste vide alors que le sandbox contient des données.
- La copie a jusqu'à 15 minutes de retard, et le cache serveur ajoute jusqu'à 60 secondes.
- Les compétences équipement ne sont pas lues dans NetSuite. Chaque technicien reçoit tout le jeu local, plus l'id 0 pour qu'un actif non reconnu reste assignable.
- La zone, l'horaire et le point de départ ne sont pas dans la requête employé. La zone reste vide, les heures restent vides (la suggestion propose 8 h à 17 h) et le départ comme l'arrivée pointent vers le siège de Drummondville.
- La ville et la région sont déduites du texte d'adresse, pour une liste courte de villes. Une adresse hors liste laisse la région vide.
- L'envoi d'heure utilise `startTime` au format `HH:MM:00`. Si le compte refuse ce format, la tâche n'est pas mise à jour.
- Le statut de cas envoyé par le bouton est `1` (Reparti). Aucune tâche n'est créée : seulement un PATCH sur une tâche déjà là.
- SuiteQL est plafonné à 25 pages de 1 000 lignes.
- Les requêtes clients et articles visent les colonnes standard (`companyname`, `itemid`, `displayname`). Un compte qui les nomme autrement répond 502 sur ces deux routes seulement.
- Les secrets TBA ne sont pas journalisés. Une erreur NetSuite est raccourcie et les secrets connus sont masqués.
