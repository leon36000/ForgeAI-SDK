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
- **PENDING**: smoke tests live avec la version exacte de Claude Code.
- **PENDING**: review indépendante humaine ou système distinct qualifié sur le HEAD final.
