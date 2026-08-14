# Claude Agent SDK Control Plane — 0.2.0-alpha.1

## Statut

**Décision acceptée:** Foundation 0.1.4 reste l’autorité de qualité. Le control plane programme Claude, mais ne remplace ni Git proof, ni les gates, ni EvidenceBundle, ni PROOF.

**Fait vérifié localement:** le cycle complet est couvert avec un faux `query()` injecté et de vrais dépôts Git temporaires. Cette preuve couvre l’orchestration, pas l’authentification ou le comportement réseau du SDK live.

**Gate externe restante:** installer et exécuter `@anthropic-ai/claude-agent-sdk@0.3.232` avec les credentials et la sandbox réellement utilisés.

## Flux

```text
TaskEnvelope EXECUTE R0/R1
        ↓
validation contrat + budget + SDK exact
        ↓
writer Claude — session A
        ↓
Git HEAD propre + scope frais
        ↓
gates Foundation exacts
        ↓
reviewer read-only — session B ≠ A
        ↓
ledger + EvidenceBundle + artefacts
        ↓
PROOF
   PASS / BLOCKED
```

R2 et R3 sont refusés avant appel SDK. Ils nécessitent respectivement une review sécurité/gates supplémentaires et une approbation humaine liée au commit.

## Qualification avant SDK

Le run est bloqué avant tout appel modèle sauf si :

- `role=writer`, `mode=EXECUTE` et `execution.harness=claude-agent-sdk`;
- la sandbox est déclarée requise et vérifiée par TaskEnvelope;
- `base_commit` est un SHA Git complet;
- `agent_depth=0`, `max_parallel_agents=1` et les agents imbriqués sont interdits;
- `metadata.writer_model` correspond exactement au modèle writer de la politique;
- aucune capacité MCP ou hôte réseau n’est déclaré;
- aucune commande Bash déclarée n’est directement réseau-capable.

La détection des commandes réseau est une barrière supplémentaire. Le SDK reçoit aussi une configuration sandbox explicite et fail-closed, mais l’isolation OS réelle reste une preuve live séparée.

L’environnement du subprocessus SDK est également filtré. Seuls les paramètres runtime nécessaires, les variables de proxy/certificat et les familles d’authentification Anthropic, Claude Code, AWS, Google/Vertex ou Azure sont transmises. Les variables applicatives arbitraires, `GITHUB_TOKEN`, `NODE_OPTIONS`, `BASH_ENV` et autres secrets non requis ne sont pas propagés.

## Isolation et permissions

### Capacité SDK commune

- `tools` borne la capacité réellement disponible; `allowedTools` auto-approuve exactement le même ensemble;
- `sandbox.enabled=true` et `sandbox.failIfUnavailable=true`;
- aucun escape non sandboxé (`allowUnsandboxedCommands=false`);
- réseau commandé refusé par défaut (`deniedDomains=["*"]`, allowlist stricte);
- sockets Unix, binding local et recherche Mach refusés;
- MCP explicitement vide et strict.

Ces options sont une défense en profondeur. `execution.sandbox_verified=true` reste obligatoire dans TaskEnvelope et doit être démontré avec le système d’exploitation et la version SDK réellement utilisés.

### Writer

- outils autorisés: `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash`;
- `Agent`, outils d’équipe, web, MCP et outils non gouvernés refusés;
- chaque appel passe par `checkToolUse()` de Foundation;
- seules les commandes argv exactes du TaskEnvelope sont exécutables;
- sandbox vérifiée et worktree isolé restent obligatoires dans le TaskEnvelope.

### Reviewer

- nouvelle requête SDK sans `resume`, `continue` ou fork;
- outils autorisés: `Read`, `Glob`, `Grep`;
- aucune écriture, aucun shell, aucun réseau, aucun MCP;
- verdict lié au `final_commit` et hashé dans EvidenceBundle;
- réutilisation de la session writer: `BLOCKED`.

Chaque invocation est bornée par la deadline absolue de TaskEnvelope. Le runner transmet un `AbortController` au SDK, annule le flux à échéance et tente de fermer son itérateur. Le hash TaskEnvelope est calculé une seule fois au démarrage afin qu’un verdict `BLOCKED` reste émis même après expiration.

Le runner compare la session reviewer à la session writer réellement retournée par le SDK et au `writer_session_id` logique de TaskEnvelope. L’identité SDK réelle est conservée dans le ledger et le résultat control-plane. Dans cette version de Foundation, EvidenceBundle ne porte que la review; un appel autonome à PROOF ne reconstruit donc pas à lui seul la session writer SDK réelle. Le control plane est l’autorité de cette vérification de fraîcheur pour l’alpha.

## Pourquoi `settingSources: []`

Les hooks Foundation `Stop`, `TaskCompleted` et `SubagentStop` exigent déjà un PROOF PASS. Les charger dans une session writer intermédiaire créerait une dépendance circulaire: le writer ne pourrait pas terminer avant la review et PROOF.

L’alpha désactive donc explicitement les settings projet dans les sessions SDK et applique la policy par `canUseTool`. Le prompt inclut les règles Superpowers essentielles. Une phase suivante devra introduire des hooks conscients de `writer`, `reviewer` et `final` avant de charger automatiquement tous les settings/skills projet.

## Contrats

### Politique

`forgeai.control-plane-policy.v0.2.0-alpha.1` fixe :

- package/version SDK exacts;
- modèles writer/reviewer;
- tours et budgets maximum par rôle;
- budget total maximum.

### Writer

`forgeai.writer-result.v0.2.0-alpha.1` exige :

- `READY_FOR_REVIEW` ou `BLOCKED`;
- SHA Git complet;
- chaque critère d’acceptation exactement une fois;
- aucun high/critical non résolu pour `READY_FOR_REVIEW`.

### Reviewer

`forgeai.reviewer-result.v0.2.0-alpha.1` exige :

- `PASS` ou `BLOCKED`;
- SHA identique au commit relu;
- findings bornés et chemins dans le scope;
- `BLOCKED` lorsqu’un high/critical reste ouvert.

## Failures fail-closed

Le résultat devient `BLOCKED` notamment si :

- SDK absent, mauvais ou sans `query()`;
- résultat terminal manquant, dupliqué ou en erreur;
- structured output malformé;
- budget ou tours dépassés;
- deadline `TaskEnvelope.expires_at` atteinte ou déjà dépassée;
- commit reporté différent de HEAD;
- scope Git invalide;
- gate absent ou rouge;
- session reviewer réutilisée;
- Git change après les gates ou la review;
- ledger, artefact, EvidenceBundle ou PROOF invalide.

Un run bloqué n’écrit jamais un faux PROOF PASS.

## Exploitation

```bash
npm install --no-save --package-lock=false @anthropic-ai/claude-agent-sdk@0.3.232
npm run control-plane -- doctor
npm run control-plane -- run task.json config/control-plane-policy.json result.json
```

Le `doctor` doit être PASS avant un run live. Le smoke live doit aussi prouver que la sandbox démarre réellement et échoue dur si ses dépendances sont absentes. Les credentials ne doivent jamais être écrits dans le dépôt, le TaskEnvelope, le ledger ou les preuves.
