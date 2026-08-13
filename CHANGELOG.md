# Changelog

## 0.1.2 — 2026-08-13

- Corrige la détection Anthropic/OpenAI afin d’éviter un finding fournisseur ambigu.
- Permet la suppression contrôlée d’un worktree validé contenant uniquement les artefacts runtime ignorés attendus.
- Rend le test d’expiration indépendant de la date courante et couvre séparément une durée de vie invalide.
- Remplace le faux statut « verified » de 0.1.1 par une vérification reproductible complète.

## 0.1.1 — 2026-08-13

- contrats TaskEnvelope/EvidenceBundle stricts;
- ledger SHA-256 chaîné et tête atomique;
- policy fail-closed par rôle, chemin, commande et réseau;
- séparation `allowed_bash_commands` / `required_test_commands`;
- recalcul Git frais et contrôle du scope;
- PROOF R0–R3, bugfix et findings load-bearing;
- hooks et profils Claude Code;
- worktrees gérés, benchmark 15 slots;
- SonarQube fail-closed lorsqu’activé;
- schéma Neon optionnel;
- suite de tests adversariaux et vérification de publication.
