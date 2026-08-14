import { setTimeout as sleepDefault } from 'node:timers/promises';
import { createBudgetTracker, deriveResponseCost, effectiveRouteLimits, RouterBudgetError } from './budget.mjs';
import { createCircuitBreaker } from './circuit-breaker.mjs';
import { createLiteLLMClient, LiteLLMClientError } from './client.mjs';
import { sha256Json, validateAdvisoryRequest, validateAdvisoryResult, validateRouterPolicy } from './contracts.mjs';
import { appendRouterLedger } from './ledger.mjs';
import { buildAdvisoryPrompts } from './prompts.mjs';
import { qualifiedRoutesForRequest } from './qualification.mjs';
import { ROUTER_RESULT_SCHEMA_VERSION } from './constants.mjs';

function iso(clock) { return new Date(clock()).toISOString(); }

function blockedResult({ request, startedAt, clock, code, message, attempts = [], accounting = null, rejected = [] }) {
  return Object.freeze({
    schema_version: ROUTER_RESULT_SCHEMA_VERSION,
    request_id: request.request_id,
    status: 'BLOCKED',
    route: null,
    result: null,
    accounting,
    attempts: Object.freeze(structuredClone(attempts)),
    rejected_routes: Object.freeze(structuredClone(rejected)),
    error: Object.freeze({ code, message }),
    started_at: startedAt,
    completed_at: iso(clock),
  });
}

function routeBreakers(policy, clock) {
  return new Map(policy.routes.map((route) => [route.route_id, createCircuitBreaker({ failureThreshold: route.circuit_breaker.failure_threshold, cooldownMs: route.circuit_breaker.cooldown_ms, clock })]));
}

function safeError(error) { return { code: error?.code ?? 'ROUTER_INTERNAL_ERROR', message: error?.message ?? 'router failure' }; }
function backoff(route, attempt) { return Math.min(route.retry.backoff_ms * (2 ** Math.max(0, attempt - 1)), 60_000); }

export function createAdvisoryRouter({ policy: policyValue, env = process.env, fetchImpl = globalThis.fetch, clock = Date.now, sleep = sleepDefault, ledgerPath = null } = {}) {
  const policy = validateRouterPolicy(policyValue);
  if (typeof clock !== 'function' || typeof sleep !== 'function') throw new TypeError('clock and sleep must be functions');
  const client = createLiteLLMClient({ fetchImpl, clock });
  const breakers = routeBreakers(policy, clock);

  function doctor() {
    const endpoint = env[policy.endpoint_env];
    const apiKey = env[policy.api_key_env];
    const routes = policy.routes.map((route) => {
      const result = qualifiedRoutesForRequest(policy, { capability: route.capabilities[0], mode: route.modes[0] }, { now: clock(), circuitBreakers: breakers });
      const candidate = result.candidates.some((item) => item.route_id === route.route_id);
      const rejection = result.rejected.find((item) => item.route_id === route.route_id);
      return { route_id: route.route_id, model: route.model, status: route.status, ready: candidate, reason: rejection?.code ?? 'QUALIFIED' };
    });
    const readyRoutes = routes.filter((route) => route.ready).length;
    return Object.freeze({
      schema_version: 'forgeai.litellm-router-doctor.v0.3.0-alpha.1',
      policy_id: policy.policy_id,
      status: endpoint && apiKey && readyRoutes > 0 ? 'PASS' : 'BLOCKED',
      endpoint_configured: typeof endpoint === 'string' && endpoint.length > 0,
      api_key_configured: typeof apiKey === 'string' && apiKey.length > 0,
      ready_routes: readyRoutes,
      routes: Object.freeze(routes),
    });
  }

  async function run(requestValue) {
    const request = validateAdvisoryRequest(requestValue);
    const startedAt = iso(clock);
    const requestHash = sha256Json(request);
    const endpoint = env[policy.endpoint_env];
    const apiKey = env[policy.api_key_env];
    if (typeof endpoint !== 'string' || endpoint.length === 0) return blockedResult({ request, startedAt, clock, code: 'ENDPOINT_MISSING', message: `${policy.endpoint_env} is not configured` });
    if (typeof apiKey !== 'string' || apiKey.length === 0) return blockedResult({ request, startedAt, clock, code: 'API_KEY_MISSING', message: `${policy.api_key_env} is not configured` });
    const selection = qualifiedRoutesForRequest(policy, request, { now: clock(), circuitBreakers: breakers });
    if (selection.candidates.length === 0) return blockedResult({ request, startedAt, clock, code: 'NO_QUALIFIED_ROUTE', message: 'no qualified route is available', rejected: selection.rejected });
    const candidates = request.allow_fallback ? selection.candidates : selection.candidates.slice(0, 1);
    const deadlineAt = clock() + request.timeout_ms;
    const budget = createBudgetTracker({ maxCostUsd: request.max_cost_usd, maxTotalTokens: request.max_total_tokens, deadlineAt, clock });
    const attempts = [];
    const prompts = buildAdvisoryPrompts(request);

    for (const route of candidates) {
      const breaker = breakers.get(route.route_id);
      const limits = effectiveRouteLimits(request, route);
      let routeFailedRetryably = false;
      for (let attempt = 1; attempt <= route.retry.max_attempts; attempt += 1) {
        let remaining;
        try { remaining = budget.assertTime(); } catch (error) {
          return blockedResult({ request, startedAt, clock, code: error.code, message: error.message, attempts, accounting: error.details, rejected: selection.rejected });
        }
        const attemptStarted = iso(clock);
        try {
          const response = await client.invoke({
            baseUrl: endpoint,
            apiKey,
            model: route.model,
            systemPrompt: prompts.system,
            userPrompt: prompts.user,
            maxOutputTokens: limits.max_output_tokens,
            timeoutMs: Math.max(1, Math.min(remaining, limits.max_timeout_ms)),
            requestId: request.request_id,
          });
          const cost = deriveResponseCost({ usage: response.usage, responseCost: response.response_cost_usd, pricing: route.pricing });
          if (cost === null) throw new LiteLLMClientError('COST_ACCOUNTING_UNCERTAIN', 'billed HTTP 200 response had no reliable cost', { responseReceived: true });
          budget.assertTime();
          if (response.usage.output_tokens > limits.max_output_tokens) throw new RouterBudgetError('ROUTE_OUTPUT_TOKEN_LIMIT_EXCEEDED', 'response exceeded the effective output-token limit', { usage: response.usage, limit: limits.max_output_tokens });
          if (response.usage.total_tokens > route.limits.max_total_tokens) throw new RouterBudgetError('ROUTE_TOKEN_LIMIT_EXCEEDED', 'response exceeded the qualified route total-token limit', { usage: response.usage, limit: route.limits.max_total_tokens });
          if (cost > route.limits.max_cost_usd + Number.EPSILON) throw new RouterBudgetError('ROUTE_COST_LIMIT_EXCEEDED', 'response exceeded the qualified route cost limit', { cost_usd: cost, limit: route.limits.max_cost_usd });
          let accounting;
          try { accounting = budget.record({ costUsd: cost, totalTokens: response.usage.total_tokens }); } catch (error) {
            attempts.push({ route_id: route.route_id, model: route.model, attempt, status: 'BLOCKED', error_code: error.code, started_at: attemptStarted, completed_at: iso(clock), usage: response.usage, cost_usd: cost });
            await appendRouterLedger(ledgerPath, { request_id: request.request_id, request_hash: requestHash, mode: request.mode, capability: request.capability, route_id: route.route_id, model: route.model, attempt, status: 'BLOCKED', error_code: error.code, ...response.usage, cost_usd: cost, started_at: attemptStarted, completed_at: iso(clock), qualification_evidence_sha256: route.qualification.evidence_sha256, prompt_sha256: prompts.prompt_sha256 });
            return blockedResult({ request, startedAt, clock, code: error.code, message: error.message, attempts, accounting: error.details, rejected: selection.rejected });
          }
          let parsed;
          try { parsed = JSON.parse(response.content); } catch { throw new LiteLLMClientError('ADVISORY_JSON_INVALID', 'billed advisory response was not valid JSON', { responseReceived: true, details: { usage: response.usage, response_cost_usd: cost } }); }
          let result;
          try { result = validateAdvisoryResult(parsed); } catch (error) { throw new LiteLLMClientError('ADVISORY_CONTRACT_INVALID', error.message, { responseReceived: true, details: { usage: response.usage, response_cost_usd: cost } }); }
          budget.assertTime();
          breaker.recordSuccess(route.route_id);
          attempts.push({ route_id: route.route_id, model: route.model, attempt, status: result.status, started_at: attemptStarted, completed_at: iso(clock), usage: response.usage, cost_usd: cost });
          await appendRouterLedger(ledgerPath, { request_id: request.request_id, request_hash: requestHash, mode: request.mode, capability: request.capability, route_id: route.route_id, model: route.model, attempt, status: result.status, ...response.usage, cost_usd: cost, started_at: attemptStarted, completed_at: iso(clock), qualification_evidence_sha256: route.qualification.evidence_sha256, prompt_sha256: prompts.prompt_sha256 });
          return Object.freeze({
            schema_version: ROUTER_RESULT_SCHEMA_VERSION,
            request_id: request.request_id,
            status: result.status,
            route: Object.freeze({ route_id: route.route_id, model: route.model, qualification_evidence_sha256: route.qualification.evidence_sha256 }),
            result,
            accounting,
            attempts: Object.freeze(structuredClone(attempts)),
            rejected_routes: selection.rejected,
            error: null,
            started_at: startedAt,
            completed_at: iso(clock),
          });
        } catch (error) {
          let failure = safeError(error);
          const billedUsage = error?.details?.usage ?? null;
          const billedCost = deriveResponseCost({ usage: billedUsage, responseCost: error?.details?.response_cost_usd ?? null, pricing: route.pricing });
          if (error?.responseReceived === true && billedCost !== null) {
            try {
              if (billedCost > route.limits.max_cost_usd + Number.EPSILON) throw new RouterBudgetError('ROUTE_COST_LIMIT_EXCEEDED', 'billed response exceeded the qualified route cost limit', { cost_usd: billedCost, limit: route.limits.max_cost_usd });
              if (billedUsage && billedUsage.total_tokens > route.limits.max_total_tokens) throw new RouterBudgetError('ROUTE_TOKEN_LIMIT_EXCEEDED', 'billed response exceeded the qualified route token limit', { usage: billedUsage, limit: route.limits.max_total_tokens });
              budget.record({ costUsd: billedCost, totalTokens: billedUsage?.total_tokens ?? 0 });
            } catch (budgetError) {
              failure = safeError(budgetError);
              error = budgetError;
            }
          }
          attempts.push({ route_id: route.route_id, model: route.model, attempt, status: 'BLOCKED', error_code: failure.code, started_at: attemptStarted, completed_at: iso(clock), ...(billedUsage ? { usage: billedUsage } : {}), ...(billedCost === null ? {} : { cost_usd: billedCost }) });
          await appendRouterLedger(ledgerPath, { request_id: request.request_id, request_hash: requestHash, mode: request.mode, capability: request.capability, route_id: route.route_id, model: route.model, attempt, status: 'BLOCKED', error_code: failure.code, ...(billedUsage ?? {}), ...(billedCost === null ? {} : { cost_usd: billedCost }), started_at: attemptStarted, completed_at: iso(clock), qualification_evidence_sha256: route.qualification.evidence_sha256, prompt_sha256: prompts.prompt_sha256 });
          const terminal = error instanceof RouterBudgetError || error?.responseReceived === true || error?.terminal === true || error?.retryable !== true;
          if (terminal) return blockedResult({ request, startedAt, clock, code: failure.code, message: failure.message, attempts, accounting: budget.snapshot(), rejected: selection.rejected });
          routeFailedRetryably = true;
          if (attempt < route.retry.max_attempts) {
            const wait = Math.min(backoff(route, attempt), budget.assertTime());
            if (wait > 0) await sleep(wait, undefined, { ref: false });
          }
        }
      }
      if (routeFailedRetryably) breaker.recordFailure(route.route_id);
    }
    return blockedResult({ request, startedAt, clock, code: 'ROUTES_EXHAUSTED', message: 'all qualified routes failed before a billable response', attempts, accounting: budget.snapshot(), rejected: selection.rejected });
  }

  return Object.freeze({ policy, doctor, run });
}
