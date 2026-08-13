# Runbook d’exploitation

## Démarrage d’une tâche

1. Geler `base_commit`.
2. Classer le risque R0–R3.
3. Définir scope, denylist, commandes et acceptance.
4. Valider le TaskEnvelope.
5. Créer un worktree géré.
6. Initialiser le ledger.
7. Démarrer un seul writer.

## Fin d’une tâche

1. Exécuter tous les tests obligatoires.
2. Committer les modifications.
3. Exiger un worktree propre.
4. Lancer reviewer frais; security frais pour R2/R3.
5. Construire le manifeste d’artefacts.
6. Sceller l’EvidenceBundle.
7. Recalculer Git et vérifier le ledger.
8. Exécuter PROOF.
9. Autoriser DONE uniquement si verdict PASS.

## Incident

- Hook indisponible: BLOCKED.
- Ledger invalide: isoler le workspace et préserver les fichiers; ne pas poursuivre.
- Test flaky: reproduire et corriger la synchronisation; ne pas augmenter arbitrairement les timeouts.
- Worker bloqué: reprendre le même agent pour trois rounds maximum; ensuite agent frais plus capable.
- Finding load-bearing: BLOCKED ou arbitrage humain, jamais consensus automatique.
- Conflit de worktrees: sérialiser les tâches qui touchent la même interface.

## Reprise après compaction

Lire le ledger, le TaskEnvelope, le HEAD Git et le dernier résultat PROOF. Le ledger et Git priment sur la mémoire conversationnelle. Ne jamais redispatcher une tâche déjà liée à un commit et à un bundle PASS.
