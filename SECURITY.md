# Security policy

Foundation fonctionne en mode fail-closed. Toute vulnérabilité soupçonnée dans les contrôles de chemins, commandes, preuves, ledger, hooks ou isolation doit être traitée comme load-bearing.

## Signalement

Ne pas publier de secret ou d’exploit contre un système réel. Fournir une reproduction locale minimale, le commit concerné, l’invariant violé et le résultat attendu. Tant que le finding n’est pas résolu ou explicitement accepté par un humain pour un risque R3, PROOF doit rester `BLOCKED`.

## Limites

Foundation ne remplace pas la sécurité de l’hôte, du sandbox, de Git, des dépendances du dépôt cible ni les politiques organisationnelles. Les profils et hooks doivent être validés avec la version exacte de Claude Code utilisée avant activation en production.
