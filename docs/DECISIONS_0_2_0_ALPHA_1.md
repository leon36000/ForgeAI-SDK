# Décisions Control Plane 0.2.0-alpha.1

## Statut

Ces décisions s’appliquent à la tranche Claude Agent SDK empilée sur Foundation 0.1.4. Elles ne changent pas les décisions canoniques Foundation ni la frontière des workers externes.

## Décisions acceptées

1. **Foundation reste l’autorité de qualité.** Le control plane réutilise TaskEnvelope, policy, Git proof, gates, ledger, EvidenceBundle et PROOF.
2. **Le SDK est chargé dynamiquement.** Le package racine conserve zéro dépendance npm; l’exécution live exige exactement `@anthropic-ai/claude-agent-sdk@0.3.232`.
3. **Un run possède un seul writer.** Aucun agent imbriqué, équipe d’agents ou writer parallèle n’est autorisé dans l’alpha.
4. **Le reviewer est une requête top-level fraîche et read-only.** Sa session doit différer de la session writer réelle et logique.
5. **Les settings projet sont désactivés dans les sessions SDK.** `settingSources: []` évite la récursion des hooks de fin avant PROOF; Foundation gouverne les outils via `canUseTool`.
6. **R0 et R1 seulement.** R2 et R3 restent sur le workflow Foundation complet avec security et approbation humaine selon le niveau.
7. **Aucun MCP ou réseau dans EXECUTE alpha.** Les hôtes, outils MCP et commandes directement réseau-capables sont refusés avant l’appel SDK.
8. **L’environnement SDK est allowlisté.** Les variables applicatives arbitraires et mécanismes d’injection comme `NODE_OPTIONS` ou `BASH_ENV` ne sont pas transmis.
9. **Aucun fallback de modèle ou de version.** Une absence ou divergence du SDK bloque le run.
10. **Le langage final du control plane reste ouvert.** L’alpha Node.js/ESM minimise le changement et valide les contrats; une migration future doit être justifiée par des mesures.
11. **OpenHands et LiteLLM EXECUTE restent séparés.** Leur qualification vient après la stabilisation et le benchmark du control plane Claude.
12. **`tools` est l’autorité de capacité SDK.** `allowedTools` n’est pas traité comme une barrière de disponibilité; il auto-approuve uniquement le même sous-ensemble déjà borné par `tools`.
13. **La sandbox SDK est explicitement fail-closed.** Elle est activée avec échec dur si indisponible, sans commandes non sandboxées, sans réseau, socket ou binding local. Cette configuration ne remplace pas la preuve live exigée par `sandbox_verified`.
14. **La deadline TaskEnvelope est une autorité d’exécution.** Writer et reviewer reçoivent la même échéance absolue; un dépassement annule le SDK et bloque le run. Le hash de tâche est figé avant l’exécution pour rester disponible après expiration.

## Limites assumées

- Les tests fake-SDK prouvent le workflow et les gates, pas l’authentification ou le comportement réseau du SDK live.
- La fraîcheur de la session writer SDK réelle est vérifiée par le runner et enregistrée dans ledger/résultat. EvidenceBundle v0.1.1 ne transporte pas encore cette identité writer réelle.
- Les smoke tests avec le CLI Claude Code réel, la review indépendante et la décision humaine restent des gates externes.
