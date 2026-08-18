# Modèle de menace

## Actifs

Code source, historique Git, secrets, environnement, preuves, ledger, hooks Claude, budget modèles et intégrité du verdict.

## Menaces traitées

- sortie de scope par chemin absolu, `..`, symlink ou caractères de contrôle;
- races TOCTOU et remplacement de fichiers/répertoires pendant lecture;
- ReDoS par glob adversarial;
- shell injection, wrappers shell et commandes destructrices variantes;
- exfiltration réseau et protocoles non HTTP(S);
- écriture par rôle read-only ou modification du control plane;
- faux DONE, test omis, résultat falsifié ou review liée à un ancien commit;
- bundle/JSON/sortie/inventaire sans borne;
- suppression, réordonnancement ou symlink dans le ledger;
- agent externe exécutant sans harness/sandbox;
- perte de progression après compaction;
- build périmé ou manifeste incomplet.

## Menaces résiduelles

- compromission de l’hôte, de Git, du runner ou du sandbox;
- dépendances et scripts explicitement autorisés par le dépôt cible;
- plateforme sans primitive no-follow sécurisée — elle est bloquée, non supportée;
- acteur humain ayant accès au filesystem et aux clés;
- incompatibilité future des hooks Claude Code;
- vulnérabilités non détectées par tests, CodeQL, Sonar ou review.
