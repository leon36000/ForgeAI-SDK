# Spécification — Foundation 0.1.4

## Autorité

Foundation 0.1.4 est l’autorité locale de qualité. Une absence de contrat, preuve, sandbox, capability de sécurité, test ou review requise produit `BLOCKED`.

## Commandes

Les commandes déclarées sont parsées en argv borné. L’identité contractuelle est l’argv canonique. Les métacaractères shell et les wrappers d’interpréteur sont refusés. L’exécution utilise `shell:false`, un environnement minimal et un répertoire HOME isolé dans les preuves.

## Fichiers

Les lectures load-bearing utilisent une ouverture no-follow, exigent un fichier régulier, bornent la taille, puis comparent identité et métadonnées avant/après lecture. Les parcours refusent symlinks et entrées non régulières, bornent le nombre de fichiers et détectent le remplacement d’un répertoire pendant l’énumération.

## Preuves

Un EvidenceBundle est borné à 8 MiB. Les collections ont des maxima explicites. Les objets imbriqués refusent les clés inconnues. Chaque review contient rôle, modèle, session, verdict, contexte frais, nombre de findings, hash de preuve et commit final. Une session identique au writer ou un commit différent bloque.

## Surface d’outils Claude Code

`PreToolUse` ForgeAI s’applique à tous les appels d’outil sans matcher restrictif. La policy interne autorise explicitement les surfaces modélisées et bloque les nouveaux outils par défaut. `Agent` n’est utilisable que par l’orchestrateur du thread principal; un subagent ne peut pas créer un autre agent. Les shells ou réseaux alternatifs non modélisés, notamment PowerShell et WebSearch, restent `BLOCKED` jusqu’à qualification explicite.

## Gates

- R0: contrat, ledger, Git propre/scope, tests requis, acceptance, manifestes.
- R1: R0 + review indépendante liée au commit.
- R2: R1 + security review, gate sécurité, gate intégration et CodeQL.
- R3: R2 + approbation humaine liée au commit.
- Bugfix: test de régression obligatoire.

## Release

La release exige manifeste exact dans les deux sens, lint, audit sécurité, tests, doctor, exemple valide et arbre Git propre. CodeQL produit du SARIF; zéro résultat est exigé. SonarQube devient fail-closed uniquement lorsqu’il est activé comme requis.
