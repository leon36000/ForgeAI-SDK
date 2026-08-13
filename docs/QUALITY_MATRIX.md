# Matrice de qualité

| Risque | Tests contractuels | Git/scope | Review fraîche | Security | Intégration | Humain |
|---|---:|---:|---:|---:|---:|---:|
| R0 | requis | requis | non | non | non | non |
| R1 | requis | requis | requis | selon tâche | selon tâche | non |
| R2 | requis | requis | requis | review + gate | gate | non |
| R3 | requis | requis | requis | review + gate | gate | approbation liée au commit |

Tout bugfix exige en plus un test de régression. Tout finding high/critical ouvert bloque.
