# Matrice de qualité

| Risque | Tests | Git/scope | Review fraîche | Sécurité | Intégration | CodeQL | Humain |
|---|---:|---:|---:|---:|---:|---:|---:|
| R0 | requis | requis | non | non | non | selon CI | non |
| R1 | requis | requis | requis | selon tâche | selon tâche | selon CI | non |
| R2 | requis | requis | requis | review + gate | gate | requis | non |
| R3 | requis | requis | requis | review + gate | gate | requis | approbation liée au commit |

Tout bugfix exige un test de régression. Tout finding high/critical ouvert bloque.
