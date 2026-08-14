# Runbook d’exploitation

## Démarrage Foundation

1. Geler `base_commit` et classer R0–R3.
2. Définir scope, commandes argv, réseau et acceptance.
3. Valider TaskEnvelope et `doctor` Foundation.
4. Créer worktree, sandbox vérifiée et ledger.
5. Démarrer un writer unique.

## Démarrage control plane alpha

1. Limiter la tâche à R0/R1; R2/R3 sont bloqués par conception.
2. Exiger `role=writer`, `mode=EXECUTE`, harness `claude-agent-sdk`, sandbox vérifiée, SHA de base complet et un seul writer.
3. Refuser toute déclaration MCP/réseau et toute commande directement réseau-capable.
4. Installer exactement `@anthropic-ai/claude-agent-sdk@0.3.232` hors manifeste Foundation.
5. Exécuter `npm run control-plane -- doctor`; toute absence ou version SDK divergente bloque.
6. Vérifier que les options live exposent `tools` par rôle, MCP vide, sandbox activée, `failIfUnavailable=true`, `allowUnsandboxedCommands=false`, réseau/sockets/binding local refusés.
7. Vérifier modèles, tours et budgets dans `config/control-plane-policy.json`.
8. Lancer `npm run control-plane -- run <task.json> <policy.json> [result.json]`.
9. Conserver le résultat, EvidenceBundle, proof, ledger et logs de gates dans `.forgeai`.

## Cycle automatique

1. Le writer reçoit une session SDK neuve et les outils autorisés.
2. Foundation gouverne chaque outil par `canUseTool`.
3. Le writer committe; Git HEAD, propreté et scope sont recalculés.
4. Tous les gates requis s’exécutent sans shell.
5. Un reviewer read-only reçoit une session distincte.
6. Git est recalculé après la review.
7. Ledger, EvidenceBundle et artefacts sont scellés.
8. PROOF autorise `PASS` ou impose `BLOCKED`.

## Fin

1. Exiger un worktree propre et un PROOF lié au HEAD courant.
2. Pour R2/R3, utiliser le workflow Foundation complet hors alpha avec security et approbation humaine.
3. Ne déclarer DONE que si le verdict final est `PASS`.
4. Conserver coût, tours, sessions et hashes pour le benchmark `cost_per_verified_success`.

## Incident

- SDK absent ou version différente: BLOCKED;
- sandbox SDK indisponible, escape non sandboxé ou réseau/socket autorisé: BLOCKED;
- capability no-follow absente: BLOCKED;
- hook, ledger, manifeste ou SARIF invalide: BLOCKED;
- deadline TaskEnvelope atteinte, timeout ou overflow: déclencher `AbortController`, fermer le flux en best effort, conserver les logs, BLOCKED;
- résultat SDK ou JSON structuré invalide: BLOCKED;
- session reviewer identique au writer: BLOCKED;
- test flaky: reproduire et corriger la synchronisation;
- finding load-bearing: corriger ou arbitrage humain R3;
- conflit de worktrees: sérialiser les tâches couplées.

## Reprise

Lire TaskEnvelope, ledger, résultat control plane, HEAD Git et dernier PROOF. Git et ledger priment sur la mémoire conversationnelle. Ne jamais reprendre ou redispatcher une tâche déjà scellée PASS sans une nouvelle TaskEnvelope.
