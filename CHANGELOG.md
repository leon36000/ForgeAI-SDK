# Changelog

## 0.1.4 — 2026-08-14

- Remplace les globs regex dynamiques par un automate borné, fermant le risque ReDoS.
- Exécute les gates par argv avec `shell:false`; bloque wrappers shell, protocoles réseau non HTTP(S), suppressions récursives dangereuses et variantes de `git clean -f`.
- Ajoute des lectures no-follow stables, des parcours d’arbre bornés et des écritures atomiques pour fermer les races TOCTOU confirmées par CodeQL.
- Lie chaque review indépendante au `final_commit` et scelle son evidence hash.
- Borne contrats, bundles, CLI, JSON, inventaires, artefacts, sorties de processus et ledger.
- Durcit l’installeur par preflight, staging, rollback et refus des symlinks ambigus.
- Installe les hooks Claude Code en forme exec native `command` + `args`, ancre `PreToolUse`, migre les anciens hooks ForgeAI et préserve les hooks tiers.
- Rend CodeQL/SARIF fail-closed dans GitHub Actions et ajoute les régressions adversariales correspondantes.

## 0.1.3 — 2026-08-13

- Définit l’indépendance du reviewer par contexte/session fraîche plutôt que par modèle différent; le même modèle peut reviewer avec une session indépendante.
- Résout les hooks via `CLAUDE_PROJECT_DIR` pour rester correct lorsque le cwd change.
- Convertit toute erreur interne du wrapper de hook en exit code bloquant `2` au lieu d’un fail-open `1`.
- Protège `.claude/hooks/**` contre les writers et refuse proprement les noms d’outil absents/invalides.
- Rend la vérification du manifeste complète: fichiers non listés, entrées hors inventaire, chemins dupliqués et entrées non régulières bloquent la release.
- Ajoute des tests adversariaux couvrant ces invariants.

## 0.1.2 — 2026-08-13

- Corrige la détection Anthropic/OpenAI afin d’éviter un finding fournisseur ambigu.
- Permet la suppression contrôlée d’un worktree validé contenant uniquement les artefacts runtime ignorés attendus.
- Rend le test d’expiration indépendant de la date courante et couvre séparément une durée de vie invalide.
- Remplace le faux statut « verified » de 0.1.1 par une vérification reproductible complète.

## 0.1.1 — 2026-08-13

- contrats TaskEnvelope/EvidenceBundle stricts;
- ledger SHA-256 chaîné et tête atomique;
- policy fail-closed par rôle, chemin, commande et réseau;
- séparation `allowed_bash_commands` / `required_test_commands`;
- recalcul Git frais et contrôle du scope;
- PROOF R0–R3, bugfix et findings load-bearing;
- hooks et profils Claude Code;
- worktrees gérés, benchmark 15 slots;
- SonarQube fail-closed lorsqu’activé;
- schéma Neon optionnel;
- suite de tests adversariaux et vérification de publication.
