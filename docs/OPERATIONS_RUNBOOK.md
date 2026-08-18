# Runbook d’exploitation

## Démarrage

1. Geler `base_commit` et classer R0–R3.
2. Définir scope, commandes argv, réseau et acceptance.
3. Valider TaskEnvelope et `doctor`.
4. Créer worktree et ledger.
5. Démarrer un writer unique dans une sandbox vérifiée.

## Fin

1. Exécuter tous les tests requis.
2. Committer et exiger un worktree propre.
3. Lancer reviewer frais; security frais pour R2/R3.
4. Lier chaque review au `final_commit` et sceller son evidence hash.
5. Générer manifeste d’artefacts et EvidenceBundle.
6. Recalculer Git/ledger/manifestes et exécuter PROOF.
7. Autoriser DONE uniquement si `PASS`.

## Incident

- capability no-follow absente: BLOCKED;
- hook, ledger, manifeste ou SARIF invalide: BLOCKED;
- timeout/overflow: tuer l’arbre de processus, conserver les logs, BLOCKED;
- test flaky: reproduire et corriger la synchronisation;
- finding load-bearing: corriger ou arbitrage humain R3;
- conflit de worktrees: sérialiser les tâches couplées.

## Reprise

Lire ledger, TaskEnvelope, HEAD Git et dernier PROOF. Git et ledger priment sur la mémoire conversationnelle. Ne jamais redispatcher une tâche déjà scellée PASS.
