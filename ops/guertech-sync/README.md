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
