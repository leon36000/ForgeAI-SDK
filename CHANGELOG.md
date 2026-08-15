# Changelog

## 0.3.0-alpha.1 — 2026-08-14

- ajoute le routeur MCP→LiteLLM read-only pour CONSULT/AUDIT/REVIEW/JUDGE;
- refuse toute route sans qualification scellée, non expirée et liée au harness;
- borne contexte, sorties, tokens, coût, retries, fallback, timeout HTTP complet et circuit breaker;
- interdit les tools externes et rend toute réponse 200 à comptabilité incertaine terminale;
- ajoute un ledger hash-chaîné sans prompts, contexte, réponses brutes ni secrets;
- impose le lifecycle MCP NEW → INITIALIZING → READY et la sémantique JSON-RPC des notifications;
- conserve les quatre routes versionnées à UNQUALIFIED jusqu’aux benchmarks réels.

## 0.2.0-alpha.1 — 2026-08-14

- Ajoute un control plane programmable autour du Claude Agent SDK, sans modifier les verdicts Foundation.
- Épingle l’adaptateur live à `@anthropic-ai/claude-agent-sdk@0.3.232` et bloque si le package est absent ou différent.
- Exécute séquentiellement un writer unique, les gates déterministes, puis un reviewer read-only dans une session fraîche.
- Ajoute des sorties structurées strictes pour writer et reviewer, des limites de tours/coût, un ledger de cycle de vie et un résultat `PASS`/`BLOCKED`.
- Réutilise Git proof, EvidenceBundle, artefacts et PROOF de Foundation au lieu de dupliquer les autorités de qualité.
- Refuse R2/R3 dans cet alpha; aucun worker MCP→LiteLLM n’obtient EXECUTE.
- Qualifie chaque run avant le SDK: harness exact, writer unique, modèle lié, SHA complet et absence de MCP, réseau ou commande directement réseau-capable.
- Filtre l’environnement du subprocessus SDK afin de ne transmettre que runtime, proxy/certificats et authentification fournisseur nécessaires.
- Borne la capacité réelle avec `tools`, aligne `allowedTools` sur le même ensemble et désactive explicitement MCP.
- Force la sandbox SDK en fail-closed, sans escape non sandboxé, réseau, socket ni binding local.
- Lie chaque invocation SDK à `TaskEnvelope.expires_at`, annule par `AbortController` et retourne `BLOCKED` si une session se fige ou dépasse sa deadline.
- Conserve le hash TaskEnvelope calculé au démarrage afin qu’un blocage causé par l’expiration reste sérialisable et vérifiable.
- Ajoute une CLI `doctor`/`run` et des tests fake-SDK sur de vrais dépôts Git temporaires.

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
