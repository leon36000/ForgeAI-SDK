# Matrice de qualité

| Risque | Tests | Git/scope | Review fraîche | Sécurité | Intégration | CodeQL | Humain |
|---|---:|---:|---:|---:|---:|---:|---:|
| R0 | requis | requis | renforcée par alpha | non | non | selon CI | non |
| R1 | requis | requis | requis | selon tâche | selon tâche | selon CI | non |
| R2 | requis | requis | requis | review + gate | gate | requis | non |
| R3 | requis | requis | requis | review + gate | gate | requis | approbation liée au commit |

Le control plane 0.2.0-alpha.1 exécute R0/R1 seulement. Foundation conserve les exigences R2/R3. La sandbox SDK est configurée fail-closed et sans réseau, mais `sandbox_verified` exige encore un smoke live sur l’OS réellement déployé. Tout bugfix exige un gate de régression. Tout finding high/critical ouvert bloque.
