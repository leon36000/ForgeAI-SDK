# Intégration Claude Code

## Ordre recommandé

1. Exécuter `npm run verify` dans ce kit.
2. Lancer l’installeur sans `--apply` et vérifier le plan.
3. Créer une branche et un worktree d’intégration dans le dépôt cible.
4. Appliquer l’installation.
5. Remplacer l’exemple TaskEnvelope par un contrat lié au vrai commit de base.
6. Définir `FORGEAI_TASK_ENVELOPE` et `FORGEAI_PROOF_RESULT`.
7. Vérifier chaque scénario ci-dessous avant le canari.

## Smoke tests bloquants

- `Write` dans un fichier autorisé: autorisé pour writer.
- `Write` hors scope: bloqué.
- `Write` par reviewer: bloqué.
- `Bash` exact déclaré: autorisé.
- commande proche mais non identique: bloquée.
- commande destructive pourtant déclarée: bloquée.
- réseau hors allowlist: bloqué.
- `TaskCompleted` sans preuve: bloqué.
- `TaskCompleted` avec verdict `BLOCKED`: bloqué.
- `TaskCompleted` avec verdict `PASS` lié au HEAD courant: autorisé.
- sandbox indisponible pour EXECUTE: la tâche ne démarre pas.
- compaction: état restauré depuis le ledger, sans redispatch d’une tâche terminée.

## Profils

- `forgeai-orchestrator`: planification et arbitrage, aucune écriture.
- `forgeai-writer`: un TaskEnvelope, un worktree, aucun agent enfant.
- `forgeai-reviewer`: diff et exigences, contexte frais, read-only.
- `forgeai-auditor`: produit des findings prouvés, jamais de patch.
- `forgeai-security`: recherche et prouve les risques, read-only.
- `forgeai-verifier`: recalcule les preuves et rend PASS/BLOCKED.

## Limite de compatibilité

Le fragment de hooks est fourni comme base versionnée. Le smoke test avec la version exacte de Claude Code installée dans le dépôt cible reste obligatoire avant activation, car les interfaces d’outils peuvent évoluer.
