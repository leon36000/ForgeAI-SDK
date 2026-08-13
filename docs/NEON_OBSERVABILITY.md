# Neon Postgres — observabilité optionnelle

## Décision

Neon n’est pas dans le chemin critique de Foundation 0.1.1. Le ledger local scellé reste l’autorité. Neon sert seulement à agréger les runs, gates, coûts, tokens et findings pour comparer les couples modèle+rôle+harness.

## Schéma

La migration `sql/neon/001_observability.sql` crée `forgeai.runs`, `forgeai.gates` et `forgeai.findings`, avec contraintes et index.

## Politique de données

- ne jamais stocker prompts complets, secrets ou code source par défaut;
- stocker IDs, hashes, métriques et chemins minimaux;
- exporter uniquement après PROOF;
- panne réseau ou Neon: conserver localement et reprendre plus tard;
- Neon ne peut jamais transformer BLOCKED en PASS.

## État

Le schéma est prêt. Aucune base n’a été créée ou modifiée, faute de projet Neon explicitement sélectionné. Cette retenue évite une écriture distante non nécessaire.
