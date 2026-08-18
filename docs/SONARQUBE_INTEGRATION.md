# SonarQube

## Rôle

SonarQube ajoute une preuve statique et un Quality Gate centralisé. Il ne remplace pas les tests, le reviewer frais ni le moteur PROOF.

## Activation

```bash
export FORGEAI_SONAR_REQUIRED=1
export SONAR_HOST_URL='https://sonar.exemple'
export SONAR_PROJECT_KEY='forgeai-sdk'
export SONAR_TOKEN='secret'
npm run sonar
```

Quand le gate est requis, tout paramètre absent, scanner absent, analyse échouée, timeout ou statut autre que `OK` retourne un échec. Quand il n’est pas requis et que la configuration est absente, le script annonce explicitement `SKIPPED`.

## Passage dans EvidenceBundle

Le résultat doit être enregistré comme gate `category=security` ou `category=quality`, avec l’identifiant d’analyse et les hashes de sorties. R2/R3 exigent toujours une review sécurité indépendante en plus.

## État

L’adaptateur et ses tests locaux sont inclus. Aucun scan live n’a été exécuté, car cette session ne dispose ni du dépôt cible, ni d’un project key, ni d’un token SonarQube.
