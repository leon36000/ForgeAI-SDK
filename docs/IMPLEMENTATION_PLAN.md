# Plan d’implémentation exécuté — Foundation 0.1.1

## Lot 1 — Contrats et canonisation

- Canonical JSON déterministe et SHA-256.
- Validation stricte du TaskEnvelope.
- Schémas JSON versionnés.
- Tests des champs, expiration, sandbox, nesting et fan-out.

## Lot 2 — Autorité locale

- Ledger append-only chaîné.
- Tête atomique et verrou d’append.
- Détection de falsification, suppression et troncature.

## Lot 3 — Policy fail-closed

- Rôles write/read-only.
- Scope par glob.
- Protection des fichiers de contrôle et secrets.
- Bash exact allowlist + denylist prioritaire.
- Réseau allowlist.
- Refus MCP pendant EXECUTE.

## Lot 4 — Preuves

- Inspection Git fraîche et comparaison base→final.
- Worktree propre et HEAD exact.
- Manifestes de fichiers sans symlink.
- EvidenceBundle canonique et scellé.
- PROOF R0–R3 et surcharge bugfix.

## Lot 5 — Claude Code

- Fragment de settings avec hooks.
- Profils orchestrator, writer, reviewer, auditor, security et verifier.
- Stop/TaskCompleted bloqués sans PROOF PASS.
- Installeur dry-run puis `--apply`.

## Lot 6 — Qualité et exploitation

- Tests adversariaux zéro dépendance.
- Vérification de syntaxe reconstruite à chaque run.
- Rapport de publication frais.
- Benchmark de 15 slots.
- Adaptateur SonarQube fail-closed.
- Schéma Neon optionnel pour observabilité.

## Lot 7 — Intégration cible

État: prêt, mais non exécuté faute de dépôt cible dans cette session.

Séquence obligatoire dans le vrai dépôt:

1. audit read-only et inventaire;
2. baseline 15 tâches;
3. installation en branche/worktree dédié;
4. smoke tests hooks et sandbox;
5. canari R0/R1;
6. qualification d’un seul worker externe;
7. activation progressive R2 puis SonarQube;
8. Neon seulement après validation de la télémétrie locale.
