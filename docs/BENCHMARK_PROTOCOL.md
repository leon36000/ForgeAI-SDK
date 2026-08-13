# Protocole de benchmark

Le corpus contient 15 slots figés avant les runs: mécanique, bugfix, intégration, refactor et sécurité. Chaque slot doit pointer vers une vraie tâche et un commit gelé; le kit ne fabrique aucune tâche pour améliorer le score.

Comparer:

1. système actuel;
2. Claude Code + Foundation;
3. Foundation + un worker externe harnessé;
4. routage économique par rôle.

Mesures obligatoires:

- verified success rate;
- false DONE rate;
- escaped defects;
- rework rounds;
- durée;
- coût total;
- coût par succès vérifié;
- conflits Git;
- violations de policy;
- taux de réussite par modèle+rôle+harness.

Une configuration n’est promue que si elle améliore la qualité ou réduit le coût sans dégrader les seuils de qualité convenus.
