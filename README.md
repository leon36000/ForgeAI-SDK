# ForgeAI SDK — Foundation 0.1.2

Foundation 0.1.2 est le socle fail-closed qui transforme « l’agent dit DONE » en « le travail est prouvé ». Il est autonome, sans dépendance npm, cible Node.js 20+ et Git, et conserve les contrats machine v0.1.1.

## Décisions intégrées

- Claude Code/Opus orchestre; Superpowers reste la méthode.
- Un seul writer possède un changement cohérent.
- Les rôles reviewer, auditor, security et verifier sont en lecture seule.
- Les modèles externes appelés directement par MCP→LiteLLM restent CONSULT/AUDIT/REVIEW.
- EXECUTE exige un harness qualifié, une sandbox vérifiée et un worktree isolé.
- Le résultat final est déterminé par PROOF et des gates exécutables, jamais par vote de modèles.

## Vérification locale

```bash
npm test
npm run lint
npm run verify
```

Le rapport frais est écrit dans `verification/verification-report.json`. `verification/VERIFIED` contient `PASS` uniquement si tous les gates de publication passent.

## Installation dans un dépôt

```bash
node scripts/install-into-repo.mjs /chemin/du/depot
node scripts/install-into-repo.mjs /chemin/du/depot --apply
```

La première commande est un dry-run. L’installation applique les hooks et profils sous `.claude/`, puis vend le runtime sous `.forgeai/foundation/`. L’intégration réelle doit ensuite exécuter le smoke test décrit dans `docs/INTEGRATION_CLAUDE_CODE.md`.

## Interfaces principales

- `TaskEnvelope`: contrat immuable de tâche.
- `EvidenceBundle`: preuves scellées et liées au commit.
- `Ledger`: journal chaîné SHA-256 avec tête atomique.
- `Policy engine`: permissions par rôle, chemin, commande et réseau.
- `PROOF`: verdict déterministe `PASS` ou `BLOCKED`.
- `Benchmark`: 15 slots fixes et métriques de succès vérifié.

## Périmètre

Ce paquet est prêt à intégrer dans `leon36000/ForgeAI-SDK`. L’intégration se fait d’abord sur la branche dédiée `forgeai/foundation-0.1.2`, avec CI et revue indépendante avant toute fusion dans `main`. SonarQube et Neon sont préparés, mais restent inactifs tant que leurs connexions et paramètres réels ne sont pas configurés.
