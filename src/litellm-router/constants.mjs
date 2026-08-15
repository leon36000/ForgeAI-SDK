export const LITELLM_ROUTER_POLICY_SCHEMA_VERSION = 'forgeai.litellm-router-policy.v0.3.0-alpha.1';
export const ADVISORY_REQUEST_SCHEMA_VERSION = 'forgeai.advisory-request.v0.3.0-alpha.1';
export const ADVISORY_RESULT_SCHEMA_VERSION = 'forgeai.advisory-result.v0.3.0-alpha.1';
export const ROUTER_RESULT_SCHEMA_VERSION = 'forgeai.litellm-router-result.v0.3.0-alpha.1';
export const ROUTER_LEDGER_SCHEMA_VERSION = 'forgeai.litellm-router-ledger.v0.3.0-alpha.1';

export const ADVISORY_MODES = Object.freeze(['CONSULT', 'AUDIT', 'REVIEW', 'JUDGE']);
export const ADVISORY_STATUSES = Object.freeze(['PASS', 'FINDINGS', 'NEEDS_CONTEXT', 'BLOCKED']);
export const QUALIFICATION_STATUSES = Object.freeze(['QUALIFIED', 'UNQUALIFIED', 'DISABLED']);
export const QUALIFIED_HARNESS = 'litellm-chat-completions-readonly-v1';
export const MCP_PROTOCOL_VERSION = '2025-11-25';

export const LITELLM_ROUTER_LIMITS = Object.freeze({
  max_routes: 64,
  max_capabilities: 128,
  max_routes_per_capability: 8,
  max_context_items: 32,
  max_context_item_chars: 131_072,
  max_context_chars: 262_144,
  max_objective_chars: 16_384,
  max_findings: 64,
  max_recommendations: 64,
  max_message_chars: 8_192,
  max_response_bytes: 4 * 1024 * 1024,
  max_output_tokens: 65_536,
  max_total_tokens: 1_000_000,
  max_cost_usd: 1_000,
  max_timeout_ms: 15 * 60 * 1000,
  max_retries_per_route: 4,
  max_circuit_failure_threshold: 20,
  max_circuit_cooldown_ms: 60 * 60 * 1000,
  max_retry_backoff_ms: 60_000,
  max_metadata_keys: 32,
  max_ledger_bytes: 64 * 1024 * 1024,
});
