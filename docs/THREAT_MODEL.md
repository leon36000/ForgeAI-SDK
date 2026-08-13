# Modèle de menace

## Actifs protégés

Code source, historique Git, secrets, environnement, preuves, ledger, configuration Claude, budget modèles et intégrité du verdict.

## Menaces traitées

- sortie de scope par chemin absolu, `..`, symlink ou caractères de contrôle;
- écriture d’un rôle read-only;
- commande shell non déclarée ou destructive;
- exfiltration réseau;
- modification des hooks, agents ou preuves par le writer;
- faux DONE, test omis, résultat falsifié;
- bundle lié à un ancien commit;
- suppression ou réordonnancement du ledger;
- dilution d’un reviewer expert par consensus;
- agent externe exécutant sans harness/sandbox;
- perte de progression après compaction;
- faux vert dû à un build compilé périmé.

## Menaces résiduelles

- compromission de l’OS/hôte ou de Git lui-même;
- modèle de confiance des dépendances du dépôt cible;
- vulnérabilités du sandbox utilisé;
- commande explicitement allowlistée mais intrinsèquement dangereuse;
- falsification par un acteur humain ayant accès aux clés et au filesystem;
- incompatibilité future des hooks Claude Code.

Ces risques exigent défense hôte, revue humaine R3, signatures externes ou CI distante selon le contexte.
