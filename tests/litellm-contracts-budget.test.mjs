import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBudgetTracker, deriveResponseCost, effectiveRouteLimits, RouterBudgetError } from '../src/litellm-router/budget.mjs';
import { createCircuitBreaker } from '../src/litellm-router/circuit-breaker.mjs';
import { validateAdvisoryRequest, validateAdvisoryResult, validateRouterPolicy } from '../src/litellm-router/contracts.mjs';
import { evaluateRouteQualification, qualifiedRoutesForRequest } from '../src/litellm-router/qualification.mjs';
import { advisory, policy, qualifiedRoute, request } from './litellm-router-helpers.mjs';

test('strict router policy and advisory request validate', () => {
  assert.equal(validateRouterPolicy(policy()).routes[0].route_id, 'primary');
  assert.equal(validateAdvisoryRequest(request()).mode, 'REVIEW');
  assert.equal(validateAdvisoryResult(advisory()).status, 'PASS');
});

test('unknown contract fields are rejected', () => {
  assert.throws(() => validateAdvisoryRequest({ ...request(), tools: [] }), /not allowed/u);
  assert.throws(() => validateRouterPolicy({ ...policy(), api_key: 'secret' }), /not allowed/u);
  assert.throws(() => validateAdvisoryResult({ ...advisory(), raw_prompt: 'secret' }), /not allowed/u);
});

test('request bounds aggregate context and metadata', () => {
  assert.throws(() => validateAdvisoryRequest(request({ context: Array.from({ length: 33 }, (_, index) => ({ id: `x-${index}`, kind: 'text', content: 'x' })) })), /invalid length/u);
  assert.throws(() => validateAdvisoryRequest(request({ metadata: { nested: {} } })), /must be a string/u);
});

test('policy refuses fake qualification records on unqualified routes', () => {
  const route = qualifiedRoute('x', 'test/x');
  route.status = 'UNQUALIFIED';
  assert.throws(() => validateRouterPolicy(policy([route])), /must be null/u);
});

test('qualification expires and honors the harness binding', () => {
  const route = qualifiedRoute('x', 'test/x');
  assert.equal(evaluateRouteQualification(route, { now: Date.parse('2026-01-01T00:00:00Z') }).qualified, true);
  assert.equal(evaluateRouteQualification(route, { now: Date.parse('2100-01-01T00:00:00Z') }).code, 'QUALIFICATION_EXPIRED');
  route.qualification.harness = 'different';
  assert.equal(evaluateRouteQualification(route).code, 'HARNESS_UNQUALIFIED');
});

test('selection rejects unqualified routes and open circuits', () => {
  const good = qualifiedRoute('good', 'test/good');
  const bad = { ...qualifiedRoute('bad', 'test/bad'), status: 'UNQUALIFIED', qualification: null };
  const parsed = validateRouterPolicy(policy([bad, good]));
  const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, clock: () => 100 });
  breaker.recordFailure('good');
  const selection = qualifiedRoutesForRequest(parsed, request(), { now: Date.parse('2026-01-01T00:00:00Z'), circuitBreakers: new Map([['good', breaker]]) });
  assert.equal(selection.candidates.length, 0);
  assert.deepEqual(selection.rejected.map((item) => item.code).sort(), ['CIRCUIT_OPEN', 'ROUTE_UNQUALIFIED']);
});

test('circuit breaker closes after cooldown and success', () => {
  let now = 100;
  const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 50, clock: () => now });
  assert.equal(breaker.recordFailure('route').state, 'CLOSED');
  assert.equal(breaker.recordFailure('route').state, 'OPEN');
  now = 151;
  assert.equal(breaker.canAttempt('route').allowed, true);
  assert.equal(breaker.recordSuccess('route').failures, 0);
});

test('stricter route limits are safe maxima', () => {
  const route = qualifiedRoute('x', 'test/x', { max_cost_usd: 0.1, max_total_tokens: 1000, max_output_tokens: 100, max_timeout_ms: 500 });
  assert.deepEqual(effectiveRouteLimits(request(), route), { max_output_tokens: 100, max_total_tokens: 1000, max_cost_usd: 0.1, max_timeout_ms: 500 });
});

test('budget tracks cumulative cost and tokens', () => {
  const tracker = createBudgetTracker({ maxCostUsd: 0.1, maxTotalTokens: 100, deadlineAt: 2000, clock: () => 1000 });
  assert.equal(tracker.record({ costUsd: 0.02, totalTokens: 20 }).remaining_tokens, 80);
  assert.throws(() => tracker.record({ costUsd: 0.09, totalTokens: 1 }), (error) => error instanceof RouterBudgetError && error.code === 'COST_BUDGET_EXCEEDED');
});

test('budget expiry is deterministic', () => {
  const tracker = createBudgetTracker({ maxCostUsd: 1, maxTotalTokens: 100, deadlineAt: 1000, clock: () => 1000 });
  assert.throws(() => tracker.assertTime(), /deadline/u);
});

test('response cost derives only from reliable accounting', () => {
  assert.equal(deriveResponseCost({ usage: { input_tokens: 100, output_tokens: 50 }, responseCost: null, pricing: { input_per_million_usd: 1, output_per_million_usd: 2 } }), 0.0002);
  assert.equal(deriveResponseCost({ usage: null, responseCost: null, pricing: null }), null);
});


test('qualification and policy validation delegate bounded internal responsibilities', async () => {
  const qualificationSource = await readFile(new URL('../src/litellm-router/qualification.mjs', import.meta.url), 'utf8');
  for (const helper of ['qualificationStatusFailure', 'qualificationRecordFailure', 'qualificationWindowFailure']) {
    assert.match(qualificationSource, new RegExp(`function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }
  const policySource = await readFile(new URL('../src/litellm-router/contracts.mjs', import.meta.url), 'utf8');
  for (const helper of ['parsePolicyRoutes', 'parseCapabilityRoutes']) {
    assert.match(policySource, new RegExp(`function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }
});
