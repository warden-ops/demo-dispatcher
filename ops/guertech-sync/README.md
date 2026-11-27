# Synchro prod vers sandbox : cas sous-traités et équipements

Le planificateur exclut les tâches des cas sous-traités. Dans la prod, ces
tâches portent le compte générique « Technicien Guertech » (35274) et le cas a
la case **Subcontractor case** cochée. La synchro met aussi 35274 quand la tâche
prod n'a personne (le champ Assigned est obligatoire à l'écriture), et elle ne
copiait pas la case à cocher. Résultat dans le sandbox le 2026-11-17 : 63 tâches
sous-traitées ressemblent à des tâches non affectées.

`sous-traitants-equipements.patch` (pour /opt/guertech-sync/bin/sync_prod_to_sandbox.py,
sha256 avant : 6985566fbc48eb013dbc28762f447d18d083c1a4dc15bb036e10968eb9587acf) :

- copie `custevent_nxc_subcontractor_case` sur chaque cas ;
- copie `custevent_nx_assets` (Équipement de l'appel de service, pour l'aperçu)
  quand l'équipement existe dans le sandbox ; si NetSuite refuse le champ, le cas
  est réécrit sans lui (la copie du cas n'est jamais bloquée).

Simulation faite le 2026-11-17 (lecture seule, sans --execute) sur les 63 cas :
63 cas et 64 tâches à mettre à jour, 0 erreur.

## Application (après accord d'Alexandre)

1. Copie de sauvegarde : `sudo cp -a sync_prod_to_sandbox.py sync_prod_to_sandbox.py.bak-<date>`
2. `sudo patch /opt/guertech-sync/bin/sync_prod_to_sandbox.py < sous-traitants-equipements.patch`
3. Rattrapage des 63 cas (écrit seulement dans le sandbox) :
   `sudo -u guertech-sync env NS_SANDBOX_ENV=/opt/guertech-sync/secrets/sandbox.env NS_PROD_ENV=/opt/guertech-sync/secrets/prod.env NS_STATE_DIR=/opt/guertech-sync/state python3 /opt/guertech-sync/bin/sync_prod_to_sandbox.py --source prod --case-ids $(cat backfill_case_ids.txt) --execute`
4. Vérifier le bilan (erreurs = 0) et que le minuteur tourne toujours.

`backfill_case_ids.txt` : ids prod des 63 cas.

## Alertes « UE_Customer_AddUserNote » (2026-11-19)

Depuis le 2026-11-19 8 h, le sandbox envoie un courriel d'erreur environ toutes
les 15 minutes : script utilisateur `UE_Customer_AddUserNote` (déploiement 18531),
`INSUFFICIENT_PERMISSION`, il manque « Listes > Documents et fichiers » au rôle
d'intégration.

Cause : deux nouveaux clients prod ont été copiés dans le sandbox à 8 h
(PROD-CUST-3032 et PROD-CUST-480348). Ensuite, à chaque passage, la synchro
réécrivait ces copies (et les chantiers PROD-JOB déjà copiés), parce que
l'identifiant sandbox de la copie diffère de l'identifiant prod. Chaque
réécriture d'un client déclenche le script, qui échoue, d'où un courriel.

`clients-sans-reecriture.patch` (à appliquer après `sous-traitants-equipements.patch`,
sha256 avant : 506f2d5a835c05695cca77ed95305415c2d27bf4530abb9c0eaf6fc5041b6ceb,
après : 5b4ce2d73fc24f34ac060c8ddc153a87ca1a363007f6b5065c9500459812877c) :
une copie client ou chantier déjà présente est réutilisée sans être réécrite.

Simulation du 2026-11-19 (lecture seule, depuis 7 h 50) : avant 4 écritures
client et 60 écritures chantier par passage, après 0 et 0 ; cas et tâches
inchangés.

Une nouvelle copie client déclenchera encore le script une fois. Correctif
permanent, dans le sandbox seulement : ajouter « Listes > Documents et fichiers »
(Afficher) au rôle d'intégration, ou retirer le contexte Web services / REST du
déploiement 18531 (filtrage par contexte).

Application : même marche que plus haut (copie de sauvegarde, `sudo patch`,
puis vérifier au passage suivant du minuteur : bilan sans erreur, plus de courriel).

## Sous-traitant FSM (2026-11-26)

Constat le 2026-11-26 : le cas CASE18282 (prod 562671, réactif « À replanifier »,
tâche du 27 nov.) n'est plus sous-traité en prod, mais sa copie du sandbox
gardait le sous-traitant FSM 4630 du rafraichissement du 11 nov. Le planificateur
l'excluait donc comme « sous-traitant ». La synchro ne lisait pas
`custevent_fsm_subcontractor` et ne vidait jamais un champ devenu vide en prod.

`sous-traitant-fsm.patch` (à appliquer après `clients-sans-reecriture.patch`,
sha256 avant : 5b4ce2d73fc24f34ac060c8ddc153a87ca1a363007f6b5065c9500459812877c,
après : 7ec2a7bd38fe31f6b756984b022c7d8a603a9ea37d2cb339b888b48c63e4b925) :

- lit `custevent_fsm_subcontractor` sur chaque cas prod ;
- l'écrit sur la copie du sandbox, avec `null` quand il est vide en prod (efface
  la valeur restée dans le sandbox) ;
- si le sandbox refuse un sous-traitant prod qu'il ne connaît pas, le cas est
  réécrit sans ce champ (la case à cocher Subcontractor case reste copiée).

Appliqué sur le VPS le 2026-11-26 à 15 h 09 (Toronto), avec l'accord d'Alexandre.
Copie de sauvegarde : `/opt/guertech-sync/bin/sync_prod_to_sandbox.py.bak-20261126-200924`.
Écriture ponctuelle (sandbox seulement) : `--case-ids 562671 --execute`, à 15 h 10,
bilan 1 cas mis à jour, 0 erreur. Le cas s'affiche maintenant dans le planificateur.

Les cas qui changent en prod passent par ce chemin au fil des passages de 15 min.
Pas de passe de suppression : une tâche effacée en prod reste dans le sandbox.
