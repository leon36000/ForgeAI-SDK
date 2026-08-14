# Workers externes MCP→LiteLLM

## Règle

Un modèle DeepSeek, Grok, GLM, Muse ou autre appelé directement via MCP→LiteLLM n’hérite pas du harness Claude Code.

## Modes autorisés initialement

- CONSULT: réponse structurée, aucun outil d’écriture.
- AUDIT: findings avec preuve et reproduction, aucun patch.
- REVIEW: diff et exigences, aucun patch.

## EXECUTE

EXECUTE n’est activé qu’après qualification de `modèle + rôle + harness + sandbox`. OpenHands est le candidat initial pour les workers externes qui doivent lire, éditer, exécuter et retester. Pi/OpenCode restent des alternatives à benchmarker, pas des dépendances simultanées.

## Contrat de délégation

Claude Code fournit TaskEnvelope, commit de base, worktree, limites, acceptance et format de retour. Le worker retourne commit, diff, gates et artefacts. Claude Code ne fait pas confiance à ce rapport: le verifier recalcule Git et PROOF.

## Qualification

Comparer au minimum: tool calling, exactitude des edits, tests, scope, comportement face aux permissions, reprise, coût, tours, latence et `cost_per_verified_success`. Aucun fallback automatique vers un modèle non qualifié.

## Relation avec le control plane Claude

Le control plane 0.2.0-alpha.1 ne change pas cette frontière. Il programme uniquement des workers Claude via Claude Agent SDK. Les modèles externes restent read-only via MCP→LiteLLM jusqu’à qualification séparée d’un harness EXECUTE, d’une sandbox et de leurs propres benchmarks.
