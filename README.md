# ForgeAI SDK — Control Plane 0.2.0-alpha.1

ForgeAI combine **Foundation 0.1.4**, qui décide si le travail est prouvé, et un premier **control plane Claude Agent SDK**, qui programme le workflow writer → gates → reviewer → PROOF.

Le dépôt cible Node.js 20+, Git et un système capable d’ouvrir les fichiers avec une protection no-follow. Foundation conserve zéro dépendance npm runtime ou développement. Le SDK Claude est une précondition séparée uniquement pour l’exécution live du control plane.

## Invariants

- Claude Code/Opus orchestre; Superpowers reste la méthode.
- Un seul writer possède un changement cohérent.
- Reviewer, auditor, security et verifier restent en lecture seule.
- Un modèle appelé directement par MCP→LiteLLM reste CONSULT/AUDIT/REVIEW.
- EXECUTE exige un harness qualifié, une sandbox vérifiée et un worktree isolé.
- PROOF rend `PASS` ou `BLOCKED` à partir de Git, gates, reviews scellées, ledger et artefacts.
- Une review n’est valide que si sa session est indépendante et son verdict lié au `final_commit`.
- Le control plane alpha refuse R2/R3 plutôt que de prétendre fournir la review sécurité et l’approbation humaine requises.

## Control plane alpha

Le runner :

1. valide TaskEnvelope, politique de coût et qualification d’exécution;
2. exige un SHA de base complet, un writer unique, le harness `claude-agent-sdk`, le modèle writer déclaré et aucune capacité MCP/réseau;
3. charge exactement `@anthropic-ai/claude-agent-sdk@0.3.232`;
4. lance un writer unique avec `tools` limité au rôle, `allowedTools` limité au même ensemble et `permissionMode: "dontAsk"`;
5. recalcule Git et exécute les gates Foundation;
6. lance un reviewer dans une nouvelle session, avec `Read`, `Glob` et `Grep` seulement;
7. scelle EvidenceBundle et ledger;
8. laisse PROOF décider `PASS` ou `BLOCKED`.

Le cœur est testable sans appel payant par injection d’un faux `query()`. L’exécution live échoue explicitement si le SDK exact n’est pas installé.

```bash
npm install --no-save --package-lock=false @anthropic-ai/claude-agent-sdk@0.3.232
npm run control-plane -- doctor
npm run control-plane -- run /chemin/task.json config/control-plane-policy.json
```

Dans cet alpha, `settingSources` est explicitement vide. Foundation applique sa policy via `canUseTool`, ce qui évite que les hooks de fin de tâche exigent PROOF avant que writer et reviewer aient terminé. Le passage aux settings/skills projet complets exige d’abord des hooks conscients des phases.

`tools` constitue la capacité réelle exposée par le SDK; `allowedTools` ne sert qu’à auto-approuver ce même sous-ensemble. Le writer reçoit `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash`; le reviewer reçoit uniquement `Read`, `Glob`, `Grep`.

Le SDK est aussi configuré avec une sandbox explicite et fail-closed: activation obligatoire, `failIfUnavailable: true`, aucun escape non sandboxé, réseau refusé (`deniedDomains: ["*"]`, allowlist stricte), sockets et binding local refusés. Cette configuration renforce le contrat, mais ne remplace pas la qualification live de la sandbox réellement déployée.

Chaque appel writer/reviewer est lié à `TaskEnvelope.expires_at`. Une session bloquée est annulée par `AbortController`; l’itérateur est fermé en best effort et le run revient `BLOCKED` avec le hash de tâche calculé avant expiration.

La qualification refuse aussi les commandes directement capables d’ouvrir le réseau (`curl`, `wget`, `npx`, `git fetch/push/clone`, installation ou publication de paquets, ou argument HTTP(S)). L’environnement transmis au SDK est allowlisté: paramètres runtime, proxy/certificat et variables d’authentification des fournisseurs pris en charge seulement. Les variables applicatives arbitraires ne sont pas copiées.

## Vérification

```bash
npm test
npm run lint
npm run verify
```

Le rapport frais est écrit dans `verification/verification-report.json`. `verification/VERIFIED` contient `PASS` uniquement si tous les gates locaux passent sur un arbre Git propre.

## Installation Foundation dans un dépôt

```bash
node scripts/install-into-repo.mjs /chemin/du/depot
node scripts/install-into-repo.mjs /chemin/du/depot --apply
```

La première commande est un dry-run. L’installeur refuse les symlinks ou types ambigus, remplace le runtime par staging atomique et conserve une restauration en cas d’échec.

## Limites explicites

- Le control plane alpha est qualifié par tests fake-SDK; aucun appel live payant ni succès de sandbox OS réelle n’est revendiqué dans cette branche.
- Le CLI Claude Code réel, la review indépendante externe et la décision humaine de fusion restent des gates séparées.
- OpenHands et MCP→LiteLLM EXECUTE ne sont pas activés.
- SonarQube est optionnel tant que `FORGEAI_SONAR_REQUIRED` n’est pas activé.
- `main` ne doit jamais être fusionné automatiquement par le système.

Voir `docs/CLAUDE_AGENT_CONTROL_PLANE.md` pour les contrats et le modèle de menace de cette tranche.
