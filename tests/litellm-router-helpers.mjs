import { ADVISORY_REQUEST_SCHEMA_VERSION, ADVISORY_RESULT_SCHEMA_VERSION, LITELLM_ROUTER_POLICY_SCHEMA_VERSION } from '../src/litellm-router/constants.mjs';

export const EVIDENCE_HASH = 'a'.repeat(64);

export function qualifiedRoute(routeId, model, overrides = {}) {
  const capability = overrides.capability ?? 'code-review';
  return {
    route_id: routeId,
    model,
    status: 'QUALIFIED',
    modes: overrides.modes ?? ['CONSULT', 'AUDIT', 'REVIEW', 'JUDGE'],
    capabilities: overrides.capabilities ?? [capability],
    qualification: {
      status: 'QUALIFIED',
      harness: 'litellm-chat-completions-readonly-v1',
      benchmark_id: overrides.benchmark_id ?? `bench-${routeId}`,
      qualified_at: overrides.qualified_at ?? '2025-01-01T00:00:00.000Z',
      expires_at: overrides.expires_at ?? '2099-01-01T00:00:00.000Z',
      evidence_sha256: overrides.evidence_sha256 ?? EVIDENCE_HASH,
    },
    limits: {
      max_output_tokens: overrides.max_output_tokens ?? 2048,
      max_total_tokens: overrides.max_total_tokens ?? 10000,
      max_cost_usd: overrides.max_cost_usd ?? 1,
      max_timeout_ms: overrides.max_timeout_ms ?? 5000,
    },
    pricing: overrides.pricing ?? { input_per_million_usd: 1, output_per_million_usd: 2 },
    retry: { max_attempts: overrides.max_attempts ?? 1, backoff_ms: overrides.backoff_ms ?? 0 },
    circuit_breaker: { failure_threshold: overrides.failure_threshold ?? 2, cooldown_ms: overrides.cooldown_ms ?? 1000 },
  };
}

export function policy(routes = [qualifiedRoute('primary', 'test/primary')], capabilityRoutes) {
  return {
    schema_version: LITELLM_ROUTER_POLICY_SCHEMA_VERSION,
    policy_id: 'test-policy',
    endpoint_env: 'TEST_LITELLM_URL',
    api_key_env: 'TEST_LITELLM_KEY',
    routes,
    capability_routes: capabilityRoutes ?? { 'code-review': routes.map((route) => route.route_id) },
  };
}

export function request(overrides = {}) {
  return {
    schema_version: ADVISORY_REQUEST_SCHEMA_VERSION,
    request_id: overrides.request_id ?? 'request-1',
    mode: overrides.mode ?? 'REVIEW',
    capability: overrides.capability ?? 'code-review',
    objective: overrides.objective ?? 'Review the supplied change.',
    context: overrides.context ?? [{ id: 'diff-1', kind: 'diff', path: 'src/a.mjs', content: '+export const value = 1;\n' }],
    max_output_tokens: overrides.max_output_tokens ?? 1024,
    max_total_tokens: overrides.max_total_tokens ?? 5000,
    max_cost_usd: overrides.max_cost_usd ?? 0.5,
    timeout_ms: overrides.timeout_ms ?? 3000,
    allow_fallback: overrides.allow_fallback ?? true,
    metadata: overrides.metadata ?? { source: 'test' },
  };
}

export function advisory(overrides = {}) {
  return {
    schema_version: ADVISORY_RESULT_SCHEMA_VERSION,
    status: overrides.status ?? 'PASS',
    summary: overrides.summary ?? 'No load-bearing issue found in the supplied material.',
    findings: overrides.findings ?? [],
    recommendations: overrides.recommendations ?? [],
    confidence: overrides.confidence ?? 0.9,
  };
}

export function chatResponse(overrides = {}) {
  const result = overrides.result ?? advisory();
  return {
    id: overrides.id ?? 'chatcmpl-test',
    model: overrides.model ?? 'test/primary',
    choices: [{ index: 0, message: { role: 'assistant', content: typeof result === 'string' ? result : JSON.stringify(result), ...(overrides.tool_calls ? { tool_calls: overrides.tool_calls } : {}) }, finish_reason: 'stop' }],
    usage: overrides.usage ?? { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    ...(overrides.response_cost === undefined ? {} : { response_cost: overrides.response_cost }),
  };
}
