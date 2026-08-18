# CodeQL — gate déterministe

Le job `CodeQL deterministic gate` analyse JavaScript/TypeScript avec les suites `security-extended` et `security-and-quality`.

L’analyse utilise `upload: never` et écrit le SARIF dans `codeql-results`. `npm run codeql` vérifie ensuite localement le SARIF:

- aucun fichier SARIF: BLOCKED;
- document invalide: BLOCKED;
- une ou plusieurs alertes: BLOCKED;
- zéro résultat: PASS.

Le SARIF est conservé comme artefact GitHub Actions. Ce gate ne remplace pas une review indépendante ni les tests d’intégration.
