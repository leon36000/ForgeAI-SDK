# ForgeAI SDK — Foundation 0.1.4

Foundation 0.1.4 est le socle fail-closed qui transforme « l’agent dit DONE » en « le travail est prouvé ». Il cible Node.js 20+, Git et un système capable d’ouvrir les fichiers avec une protection no-follow. Il ne contient aucune dépendance npm runtime ou développement.

## Invariants

- Claude Code/Opus orchestre; Superpowers reste la méthode.
- Un seul writer possède un changement cohérent.
- Reviewer, auditor, security et verifier restent en lecture seule.
- Un modèle appelé directement par MCP→LiteLLM reste CONSULT/AUDIT/REVIEW.
- EXECUTE exige un harness qualifié, une sandbox vérifiée et un worktree isolé.
- PROOF rend `PASS` ou `BLOCKED` à partir de Git, tests, reviews scellées, ledger et artefacts.
- Une review n’est valide que si sa session est indépendante et son verdict lié au `final_commit`.

## Durcissement 0.1.4

- glob matcher borné sans expression régulière dynamique;
- commandes analysées en argv, `shell:false`, wrappers shell interdits;
- timeout et overflow tuent l’arbre de processus;
- lectures sensibles no-follow avec contrôles de stabilité TOCTOU;
- inventaires/manifeste/artefacts/secret scan bornés et symlink-safe;
- bundles, contrats, CLI et JSON bornés;
- écritures critiques atomiques et synchronisées;
- CodeQL produit du SARIF et toute alerte bloque la CI.

## Vérification

```bash
npm test
npm run lint
npm run verify
```

Le rapport frais est écrit dans `verification/verification-report.json`. `verification/VERIFIED` contient `PASS` uniquement si tous les gates locaux passent sur un arbre Git propre.

## Installation

```bash
node scripts/install-into-repo.mjs /chemin/du/depot
node scripts/install-into-repo.mjs /chemin/du/depot --apply
```

La première commande est un dry-run. L’installeur refuse les symlinks ou types ambigus, remplace le runtime par staging atomique et conserve une restauration en cas d’échec.

## Limites explicites

- `doctor` bloque lorsque l’ouverture sécurisée no-follow n’est pas disponible.
- SonarQube est optionnel tant que `FORGEAI_SONAR_REQUIRED` n’est pas activé.
- CodeQL, tests et audit ne remplacent pas la review indépendante ni les smoke tests avec la version réelle de Claude Code.
- `main` ne doit jamais être fusionné automatiquement par le système.
