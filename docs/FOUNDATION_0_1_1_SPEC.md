# Spécification — Foundation 0.1.1

## Conclusion

Foundation 0.1.1 constitue l’autorité locale de qualité. Elle bloque toute écriture hors scope, toute commande non déclarée, toute exécution externe non harnessée, tout faux `DONE` et toute preuve qui ne correspond pas au Git réel.

## Invariants acceptés

1. **Orchestration** — Claude Code/Opus planifie, distribue et arbitre; il n’est pas le writer par défaut.
2. **Méthode** — Superpowers régit la planification, TDD, debugging, review et vérification.
3. **Propriété** — un seul writer par changement cohérent; parallélisme uniquement entre tâches indépendantes.
4. **Indépendance** — reviewer et verifier utilisent un contexte frais et ne modifient pas le code.
5. **Agents externes** — MCP→LiteLLM ne transmet pas le harness Claude Code. CONSULT/AUDIT/REVIEW restent read-only. EXECUTE exige un harness qualifié et une sandbox vérifiée.
6. **Autorité** — tests, Git, manifestes, hooks et PROOF priment sur les déclarations des modèles.
7. **Échec sûr** — absence de contrat, sandbox, preuve ou dépendance obligatoire produit `BLOCKED`.

## Contrat TaskEnvelope

Le contrat fixe avant exécution: identité, objectif, rôle, mode, risque, commit de base, workspace, scope de fichiers, commandes autorisées, tests obligatoires, réseau autorisé, critères d’acceptation, harness, sandbox, profondeur d’agents, parallélisme, répertoire de preuves et expiration.

Règles fortes:

- `required_test_commands ⊆ allowed_bash_commands`;
- `EXECUTE` est réservé au rôle `writer`;
- `EXECUTE` exige `qualified=true`, `sandbox_required=true`, `sandbox_verified=true`;
- profondeur maximale d’agent: 1;
- fan-out maximal: 4;
- nesting interdit;
- tâche expirée: refusée.

## Politique d’outils

- Les chemins sont résolus depuis la racine Git et ne peuvent pas sortir du workspace.
- Les traversées, caractères de contrôle et symlinks sortants sont bloqués.
- `.git/**`, `.forgeai/**`, profils Claude, settings, secrets et clés sont protégés.
- Bash fonctionne par égalité exacte avec `allowed_bash_commands`; les commandes destructrices restent interdites même si déclarées.
- Le réseau fonctionne par allowlist stricte de hosts.
- Un appel MCP pendant EXECUTE est refusé. En CONSULT/AUDIT/REVIEW, seul un outil MCP nommé explicitement dans `allowed_mcp_tools` est autorisé.

## Ledger

Chaque événement contient son numéro, son horodatage, son type, son acteur, sa tâche, son payload et le hash précédent. Le hash courant couvre l’événement canonique. La tête atomique contient le compte et le dernier hash. La vérification détecte modification, réordonnancement, suppression, troncature et divergence de tête.

## EvidenceBundle

Le bundle contient:

- hash du TaskEnvelope;
- commits de base et final;
- fichiers changés;
- état Git frais;
- résultats de gates et hashes de sorties;
- critères d’acceptation;
- reviews indépendantes;
- findings et résolution;
- manifeste d’artefacts;
- tête du ledger;
- approbation humaine pour R3;
- hash canonique du bundle.

Le verifier recalcule Git depuis `base_commit..final_commit`; il ne fait pas confiance à `changed_files` rapporté par le writer.

## Gates par risque

- **R0**: contrat, ledger, Git propre/scope, tests obligatoires, acceptance, manifestes.
- **R1**: R0 + reviewer indépendant.
- **R2**: R1 + reviewer sécurité + gate sécurité + gate intégration.
- **R3**: R2 + approbation humaine explicite.
- **Bugfix**: tout niveau ajoute un test de régression.

Un finding `high` ou `critical` non résolu bloque.

## Hooks

`PreToolUse` applique la policy. `TaskCompleted`, `SubagentStop` et `Stop` exigent un résultat PROOF `PASS`. Les autres hooks journalisent ou préservent l’état. Les hooks de modèles peuvent conseiller; seules les vérifications déterministes font autorité.

## SonarQube

SonarQube est un gate supplémentaire. Quand `FORGEAI_SONAR_REQUIRED=1`, l’absence de scanner, de credentials, l’échec d’analyse, le timeout ou un Quality Gate non-OK bloque. Il ne remplace ni tests, ni review indépendante, ni PROOF.

## Neon Postgres

Neon est réservé à l’observabilité centralisée: runs, coûts, gates et findings. Le ledger local scellé reste la source d’autorité et le chemin critique continue de fonctionner sans réseau ni base distante.
