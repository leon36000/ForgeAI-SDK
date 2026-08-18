# Décisions — Foundation 0.1.4

- **Acceptée**: toute entrée issue d’un agent est bornée avant traitement.
- **Acceptée**: les commandes sont comparées par argv canonique, jamais par texte shell.
- **Acceptée**: aucun gate contractuel ne s’exécute avec `shell:true`.
- **Acceptée**: wrappers shell, PowerShell et `cmd /c` sont interdits, même allowlistés.
- **Acceptée**: toute lecture load-bearing utilise no-follow et vérifie la stabilité du fichier.
- **Acceptée**: un environnement sans ouverture sécurisée est `BLOCKED` par `doctor`.
- **Acceptée**: la review indépendante est liée à la session et au `final_commit`; le nom du modèle n’est pas un critère d’indépendance.
- **Acceptée**: CodeQL/SARIF est un gate déterministe; toute alerte bloque.
- **Acceptée**: SonarQube demeure un gate additionnel optionnel jusqu’à activation explicite.
- **Acceptée**: aucune fusion automatique dans `main`.
- **Acceptée**: `PreToolUse` ForgeAI est exhaustif (matcher omis) afin qu’un nouveau nom d’outil Claude Code ne puisse pas contourner la policy; les outils non modélisés restent fail-closed.
- **Acceptée**: `Agent` est autorisé uniquement au thread principal portant un TaskEnvelope `orchestrator`; tout appel depuis un subagent, un autre rôle ou un mode de permissions bypass est bloqué.
- **PENDING**: smoke tests live avec la version exacte de Claude Code.
- **PENDING**: review indépendante humaine ou système distinct qualifié sur le HEAD final.
