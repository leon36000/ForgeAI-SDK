import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdvisoryRouter } from '../src/litellm-router/router.mjs';
import { verifyRouterLedger } from '../src/litellm-router/ledger.mjs';
import { chatResponse, policy, qualifiedRoute, request } from './litellm-router-helpers.mjs';

async function server(handler) {
  const instance = createServer(handler);
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address();
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => instance.close(resolve)) };
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function routerFor(url, routes, options = {}) {
  return createAdvisoryRouter({ policy: policy(routes), env: { TEST_LITELLM_URL: url, TEST_LITELLM_KEY: 'test-key' }, ...options });
}

function json(res, status, value, headers = {}) {
  const payload = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

test('router sends no tools and returns a validated advisory result', async (t) => {
  let received;
  const service = await server(async (req, res) => { received = await body(req); json(res, 200, chatResponse({ response_cost: 0.01 })); });
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request());
  assert.equal(result.status, 'PASS');
  assert.equal(result.route.route_id, 'primary');
  assert.equal(Object.hasOwn(received, 'tools'), false);
  assert.equal(Object.hasOwn(received, 'tool_choice'), false);
  assert.equal(received.messages.length, 2);
});

test('route pricing computes cost when LiteLLM omits response cost', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse()));
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request());
  assert.equal(result.status, 'PASS');
  assert.ok(result.accounting.cost_usd > 0);
});

test('a stricter route cost limit is admissible but enforced', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse({ response_cost: 0.02 })));
  t.after(service.close);
  const route = qualifiedRoute('primary', 'test/primary', { max_cost_usd: 0.01 });
  const result = await routerFor(service.url, [route]).run(request({ max_cost_usd: 0.5 }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.error.code, 'ROUTE_COST_LIMIT_EXCEEDED');
});

test('retryable 429 retries the same qualified route', async (t) => {
  let calls = 0;
  const service = await server((req, res) => { calls += 1; if (calls === 1) json(res, 429, { error: 'busy' }); else json(res, 200, chatResponse({ response_cost: 0.01 })); });
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary', { max_attempts: 2 })], { sleep: async () => {} }).run(request());
  assert.equal(result.status, 'PASS');
  assert.equal(calls, 2);
});

test('fallback occurs only after a pre-billing retryable failure', async (t) => {
  const calls = [];
  const service = await server(async (req, res) => { const payload = await body(req); calls.push(payload.model); if (payload.model === 'test/primary') json(res, 503, { error: 'down' }); else json(res, 200, chatResponse({ model: 'test/fallback', response_cost: 0.01 })); });
  t.after(service.close);
  const routes = [qualifiedRoute('primary', 'test/primary'), qualifiedRoute('fallback', 'test/fallback')];
  const result = await routerFor(service.url, routes).run(request());
  assert.equal(result.route.route_id, 'fallback');
  assert.deepEqual(calls, ['test/primary', 'test/fallback']);
});

test('malformed billed HTTP 200 is terminal and does not fallback', async (t) => {
  const calls = [];
  const service = await server(async (req, res) => { const payload = await body(req); calls.push(payload.model); if (payload.model === 'test/primary') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{'); } else json(res, 200, chatResponse({ response_cost: 0.01 })); });
  t.after(service.close);
  const routes = [qualifiedRoute('primary', 'test/primary'), qualifiedRoute('fallback', 'test/fallback')];
  const result = await routerFor(service.url, routes).run(request());
  assert.equal(result.error.code, 'RESPONSE_JSON_INVALID');
  assert.deepEqual(calls, ['test/primary']);
});

test('known cost budget violation outranks malformed billed JSON', async (t) => {
  const service = await server((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-litellm-response-cost': '0.2' }); res.end('{'); });
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request({ max_cost_usd: 0.1 }));
  assert.equal(result.error.code, 'COST_BUDGET_EXCEEDED');
});

test('known billed cost is retained when usage is missing', async (t) => {
  const service = await server((req, res) => { const payload = chatResponse(); delete payload.usage; json(res, 200, payload, { 'x-litellm-response-cost': '0.02' }); });
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request());
  assert.equal(result.error.code, 'USAGE_MISSING');
  assert.equal(result.accounting.cost_usd, 0.02);
});

test('missing cost with no route pricing is terminal', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse()));
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary', { pricing: null })]).run(request());
  assert.equal(result.error.code, 'COST_ACCOUNTING_UNCERTAIN');
});

test('cost and token budget exceedance are terminal', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse({ response_cost: 0.2, usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })));
  t.after(service.close);
  const cost = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request({ max_cost_usd: 0.1 }));
  assert.equal(cost.error.code, 'COST_BUDGET_EXCEEDED');
  const tokens = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request({ max_cost_usd: 1, max_total_tokens: 100 }));
  assert.equal(tokens.error.code, 'TOKEN_BUDGET_EXCEEDED');
});

test('tool calls from an external model are rejected', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse({ response_cost: 0.01, tool_calls: [{ id: 'x', type: 'function', function: { name: 'bash', arguments: '{}' } }] })));
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')]).run(request());
  assert.equal(result.error.code, 'TOOL_CALL_DENIED');
});

test('absolute timeout covers a slow response body', async (t) => {
  const service = await server((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"id":"slow"'); setTimeout(() => res.end('}'), 300); });
  t.after(service.close);
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary', { max_timeout_ms: 100 })]).run(request({ timeout_ms: 100 }));
  assert.equal(result.error.code, 'LITELLM_TIMEOUT');
});

test('custom body reader that ignores abort cannot hang forever', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock: () => {} }) } });
  const result = await routerFor('http://127.0.0.1:1', [qualifiedRoute('primary', 'test/primary', { max_timeout_ms: 100 })], { fetchImpl }).run(request({ timeout_ms: 100 }));
  assert.equal(result.error.code, 'LITELLM_TIMEOUT');
});

test('ledger stores hashes and accounting but not prompts context or API key', async (t) => {
  const service = await server((req, res) => json(res, 200, chatResponse({ response_cost: 0.01 })));
  t.after(service.close);
  const dir = await mkdtemp(join(tmpdir(), 'forgeai-router-ledger-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledgerPath = join(dir, 'router.jsonl');
  const objective = 'SECRET_OBJECTIVE_SHOULD_NOT_BE_LOGGED';
  const result = await routerFor(service.url, [qualifiedRoute('primary', 'test/primary')], { ledgerPath }).run(request({ objective }));
  assert.equal(result.status, 'PASS');
  const text = await readFile(ledgerPath, 'utf8');
  assert.equal(text.includes(objective), false);
  assert.equal(text.includes('test-key'), false);
  assert.equal((await verifyRouterLedger(ledgerPath)).valid, true);
});

test('unqualified policy fails closed without network access', async () => {
  let called = false;
  const route = { ...qualifiedRoute('x', 'test/x'), status: 'UNQUALIFIED', qualification: null };
  const result = await routerFor('http://127.0.0.1:1', [route], { fetchImpl: async () => { called = true; throw new Error('should not call'); } }).run(request());
  assert.equal(result.error.code, 'NO_QUALIFIED_ROUTE');
  assert.equal(called, false);
});

function routerRunBody(text) {
  const startMarker = '  async function run(requestValue) {';
  const endMarker = '\n\n  return Object.freeze({ policy, doctor, run });';
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'run() declaration must remain discoverable');
  assert.notEqual(end, -1, 'router factory return must remain discoverable');
  return text.slice(start, end);
}

test('router run delegates orchestration through bounded private helpers', async () => {
  const source = await readFile(new URL('../src/litellm-router/router.mjs', import.meta.url), 'utf8');
  const expectedHelpers = [
    'prepareRequest',
    'selectQualifiedRoutes',
    'createAttemptPlan',
    'executeAttempt',
    'validateBilledRouteLimits',
    'recordBilledAccounting',
    'accountBilledResponse',
    'classifyAttempt',
    'recordAttempt',
    'runRouteAttempt',
    'runCandidateRoute',
    'finalizeResult',
  ];
  for (const helper of expectedHelpers) {
    assert.match(source, new RegExp(`(?:async\\s+)?function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }

  const body = routerRunBody(source);
  const nonBlankLines = body.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(nonBlankLines.length <= 18, `run() must stay orchestration-only; found ${nonBlankLines.length} non-blank lines`);
  for (const helper of ['prepareRequest', 'selectQualifiedRoutes', 'createAttemptPlan', 'runCandidateRoute', 'finalizeResult']) {
    assert.match(body, new RegExp(`\\b${helper}\\b`), `run() must delegate through ${helper}`);
  }
});

function clientInvokeBody(text) {
  const start = text.indexOf('    async invoke(');
  const end = text.indexOf('\n    },\n  });\n}', start);
  assert.notEqual(start, -1, 'client invoke() declaration must remain discoverable');
  assert.notEqual(end, -1, 'client factory return must remain discoverable');
  return text.slice(start, end);
}

test('LiteLLM client invoke delegates request, HTTP, parsing, and billed-response shaping', async () => {
  const source = await readFile(new URL('../src/litellm-router/client.mjs', import.meta.url), 'utf8');
  const expectedHelpers = [
    'validateApiKey',
    'createRequestContext',
    'buildChatPayload',
    'performRequest',
    'rejectHttpError',
    'parseBilledPayload',
    'finalizeSuccessfulResponse',
  ];
  for (const helper of expectedHelpers) {
    assert.match(source, new RegExp(`(?:async\\s+)?function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }
  const body = clientInvokeBody(source);
  const nonBlankLines = body.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(nonBlankLines.length <= 16, `invoke() must stay orchestration-only; found ${nonBlankLines.length} non-blank lines`);
  for (const helper of expectedHelpers) assert.match(body, new RegExp(`\\b${helper}\\b`), `invoke() must delegate through ${helper}`);
});

test('LiteLLM client decomposes bounded body, usage, and assistant-content validation', async () => {
  const source = await readFile(new URL('../src/litellm-router/client.mjs', import.meta.url), 'utf8');
  for (const helper of ['readStreamingBody', 'readBufferedBody', 'decodeResponseBytes', 'parseUsageTokens', 'assistantMessage']) {
    assert.match(source, new RegExp(`(?:async\\s+)?function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }
});
