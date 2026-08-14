import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewerOptions,
  buildWriterOptions,
  invokeStructuredAgent,
  loadClaudeAgentSdk,
  sanitizeControlPlaneEnvironment,
} from '../src/control-plane/sdk-adapter.mjs';
import {
  CONTROL_PLANE_POLICY_SCHEMA_VERSION,
  REVIEWER_RESULT_SCHEMA_VERSION,
  SUPPORTED_CLAUDE_AGENT_SDK,
  WRITER_RESULT_SCHEMA_VERSION,
} from '../src/control-plane/constants.mjs';
import { validateReviewerResult, validateWriterResult } from '../src/control-plane/contracts.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

function policy() {
  return {
    schema_version: CONTROL_PLANE_POLICY_SCHEMA_VERSION,
    sdk: { ...SUPPORTED_CLAUDE_AGENT_SDK },
    writer: { model: 'claude-sonnet-5', max_turns: 24, max_budget_usd: 4 },
    reviewer: { model: 'claude-sonnet-5', max_turns: 12, max_budget_usd: 2 },
    max_total_budget_usd: 6,
  };
}

function writerOutput(task) {
  return {
    schema_version: WRITER_RESULT_SCHEMA_VERSION,
    status: 'READY_FOR_REVIEW',
    summary: 'Committed the bounded change.',
    final_commit: 'a'.repeat(40),
    acceptance: task.acceptance_criteria.map((criterion) => ({ id: criterion.id, status: 'PASS', evidence: 'gate evidence' })),
    findings: [],
  };
}

function reviewerOutput() {
  return {
    schema_version: REVIEWER_RESULT_SCHEMA_VERSION,
    verdict: 'PASS',
    summary: 'Independent review passed.',
    final_commit: 'a'.repeat(40),
    findings: [],
  };
}

function reviewerTask(task) {
  return {
    ...structuredClone(task),
    role: 'reviewer',
    mode: 'REVIEW',
    allowed_mcp_tools: [],
    execution: { harness: 'claude-agent-sdk', qualified: true, sandbox_required: false, sandbox_verified: false },
  };
}

async function collectCanUse(options, toolName, input) {
  return options.canUseTool(toolName, input, {});
}

test('SDK environment passes only bounded runtime and provider variables', () => {
  const env = sanitizeControlPlaneEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/forgeai',
    ANTHROPIC_API_KEY: 'test-provider-token',
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_REGION: 'us-east-1',
    HTTPS_PROXY: 'https://proxy.example.test',
    DATABASE_URL: 'must-not-leak',
    GITHUB_TOKEN: 'must-not-leak',
    NODE_OPTIONS: '--require /tmp/evil.cjs',
    BASH_ENV: '/tmp/evil.sh',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.ANTHROPIC_API_KEY, 'test-provider-token');
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(env.AWS_REGION, 'us-east-1');
  assert.equal(env.HTTPS_PROXY, 'https://proxy.example.test');
  for (const key of ['DATABASE_URL', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'BASH_ENV']) assert.equal(env[key], undefined);
});

test('writer options are locked down and Foundation policy remains authoritative', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  const decisions = [];
  const options = buildWriterOptions(task, policy(), {
    taskEnvelopePath: `${workspace}/.forgeai/current-task.json`,
    ledgerDir: `${workspace}/.forgeai/ledger/task-001`,
    proofPath: `${workspace}/.forgeai/runtime/latest-proof.json`,
    onToolDecision: async (decision) => decisions.push(decision),
    environment: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'test-provider-token', DATABASE_URL: 'must-not-leak' },
  });
  assert.equal(options.model, 'claude-sonnet-5');
  assert.deepEqual(options.allowedTools, ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']);
  assert.deepEqual(options.tools, options.allowedTools);
  assert.ok(options.disallowedTools.includes('Agent'));
  assert.ok(options.disallowedTools.includes('WebFetch'));
  assert.equal(options.permissionMode, 'dontAsk');
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.maxTurns, 24);
  assert.equal(options.maxBudgetUsd, 4);
  assert.equal(options.outputFormat.type, 'json_schema');
  assert.equal(options.persistSession, true);
  assert.deepEqual(options.sandbox, {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    excludedCommands: [],
    allowUnsandboxedCommands: false,
    enableWeakerNestedSandbox: false,
    filesystem: {
      allowWrite: [],
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    },
    network: {
      allowedDomains: [],
      deniedDomains: ['*'],
      strictAllowlist: true,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
      allowMachLookup: [],
    },
  });
  assert.equal(options.env.FORGEAI_CONTROL_PLANE_STAGE, 'writer');
  assert.equal(options.env.ANTHROPIC_API_KEY, 'test-provider-token');
  assert.equal(options.env.DATABASE_URL, undefined);
  assert.equal((await collectCanUse(options, 'Bash', { command: 'npm test' })).behavior, 'allow');
  assert.equal((await collectCanUse(options, 'Bash', { command: 'rm -rf /' })).behavior, 'deny');
  assert.equal(decisions.length, 2);
});

test('reviewer options are fresh and read-only', async () => {
  const workspace = await tempWorkspace();
  const task = reviewerTask(sampleTask(workspace));
  const options = buildReviewerOptions(task, policy(), {
    taskEnvelopePath: `${workspace}/.forgeai/runtime/reviewer-task.json`,
    ledgerDir: `${workspace}/.forgeai/ledger/task-001`,
    proofPath: `${workspace}/.forgeai/runtime/latest-proof.json`,
  });
  assert.deepEqual(options.allowedTools, ['Read', 'Glob', 'Grep']);
  assert.deepEqual(options.tools, options.allowedTools);
  for (const tool of ['Agent', 'Edit', 'Write', 'Bash', 'WebFetch']) assert.ok(options.disallowedTools.includes(tool));
  assert.equal(options.sandbox.enabled, true);
  assert.equal(options.sandbox.failIfUnavailable, true);
  assert.equal(options.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(options.sandbox.network.deniedDomains, ['*']);
  assert.equal(options.resume, undefined);
  assert.equal(options.continue, undefined);
  assert.equal(options.forkSession, undefined);
  assert.equal(options.env.FORGEAI_CONTROL_PLANE_STAGE, 'reviewer');
  assert.equal((await collectCanUse(options, 'Write', { file_path: 'src/index.js', content: 'x' })).behavior, 'deny');
});

test('structured agent invocation returns one bounded terminal result', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  async function* query() {
    yield { type: 'system', subtype: 'init', session_id: 'writer-sdk-session' };
    yield {
      type: 'result', subtype: 'success', session_id: 'writer-sdk-session', structured_output: writerOutput(task),
      total_cost_usd: 1.25, num_turns: 8, duration_ms: 1200, modelUsage: { 'claude-sonnet-5': { inputTokens: 10, outputTokens: 20 } },
    };
  }
  const result = await invokeStructuredAgent({
    query,
    prompt: 'writer prompt',
    options: { maxTurns: 24, maxBudgetUsd: 4 },
    validate: (value) => validateWriterResult(value, task),
  });
  assert.equal(result.session_id, 'writer-sdk-session');
  assert.equal(result.total_cost_usd, 1.25);
  assert.equal(result.num_turns, 8);
  assert.equal(result.structured_output.status, 'READY_FOR_REVIEW');
  assert.deepEqual(result.message_types, ['system:init', 'result:success']);
});

test('structured invocation enforces a wall-clock deadline and aborts the SDK query', async () => {
  const controller = new AbortController();
  let returned = false;
  let receivedController = null;
  const query = ({ options }) => {
    receivedController = options.abortController;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}),
          return: async () => { returned = true; return { done: true }; },
        };
      },
    };
  };
  const startedAt = Date.now();
  await assert.rejects(
    () => invokeStructuredAgent({
      query,
      prompt: 'writer prompt',
      options: { maxTurns: 24, maxBudgetUsd: 4, abortController: controller },
      deadlineAt: new Date(Date.now() + 50).toISOString(),
      validate: (value) => value,
    }),
    /deadline/u,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(receivedController, controller);
  assert.equal(controller.signal.aborted, true);
  assert.equal(returned, true);
  assert.ok(Date.now() - startedAt < 2_000);
});

test('structured invocation rejects an invalid or expired deadline before starting the SDK', async () => {
  let calls = 0;
  const query = () => { calls += 1; return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }; };
  await assert.rejects(() => invokeStructuredAgent({ query, prompt: 'x', options: { maxTurns: 1, maxBudgetUsd: 1 }, deadlineAt: 'not-a-date', validate: (value) => value }), /deadline/u);
  await assert.rejects(() => invokeStructuredAgent({ query, prompt: 'x', options: { maxTurns: 1, maxBudgetUsd: 1 }, deadlineAt: new Date(Date.now() - 1_000).toISOString(), validate: (value) => value }), /deadline/u);
  assert.equal(calls, 0);
});

test('structured invocation rejects an invalid iterator without leaving the deadline armed', async () => {
  const controller = new AbortController();
  const query = () => ({ [Symbol.asyncIterator]: () => ({}) });
  await assert.rejects(
    () => invokeStructuredAgent({
      query,
      prompt: 'x',
      options: { maxTurns: 1, maxBudgetUsd: 1, abortController: controller },
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      validate: (value) => value,
    }),
    /iterator.*next/u,
  );
  assert.equal(controller.signal.aborted, true);
});

test('structured invocation rejects missing, duplicate, or error terminal results', async () => {
  async function* missing() { yield { type: 'assistant' }; }
  await assert.rejects(() => invokeStructuredAgent({ query: missing, prompt: 'x', options: { maxTurns: 1, maxBudgetUsd: 1 }, validate: (value) => value }), /terminal result/u);
  async function* duplicate() {
    yield { type: 'result', subtype: 'success', session_id: 'a', structured_output: {}, total_cost_usd: 0, num_turns: 1 };
    yield { type: 'result', subtype: 'success', session_id: 'a', structured_output: {}, total_cost_usd: 0, num_turns: 1 };
  }
  await assert.rejects(() => invokeStructuredAgent({ query: duplicate, prompt: 'x', options: { maxTurns: 1, maxBudgetUsd: 1 }, validate: (value) => value }), /multiple terminal/u);
  async function* failure() { yield { type: 'result', subtype: 'error_max_turns', session_id: 'a', total_cost_usd: 0.1, num_turns: 1 }; }
  await assert.rejects(() => invokeStructuredAgent({ query: failure, prompt: 'x', options: { maxTurns: 1, maxBudgetUsd: 1 }, validate: (value) => value }), /error_max_turns/u);
});

test('structured invocation rejects malformed output and exceeded limits', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  async function* malformed() { yield { type: 'result', subtype: 'success', session_id: 'a', structured_output: {}, total_cost_usd: 0, num_turns: 1 }; }
  await assert.rejects(() => invokeStructuredAgent({ query: malformed, prompt: 'x', options: { maxTurns: 2, maxBudgetUsd: 1 }, validate: (value) => validateWriterResult(value, task) }), /unexpected keys|schema/u);
  async function* cost() { yield { type: 'result', subtype: 'success', session_id: 'a', structured_output: reviewerOutput(), total_cost_usd: 2.01, num_turns: 1 }; }
  await assert.rejects(() => invokeStructuredAgent({ query: cost, prompt: 'x', options: { maxTurns: 12, maxBudgetUsd: 2 }, validate: (value) => validateReviewerResult(value, task, 'a'.repeat(40)) }), /budget/u);
  async function* turns() { yield { type: 'result', subtype: 'success', session_id: 'a', structured_output: reviewerOutput(), total_cost_usd: 1, num_turns: 13 }; }
  await assert.rejects(() => invokeStructuredAgent({ query: turns, prompt: 'x', options: { maxTurns: 12, maxBudgetUsd: 2 }, validate: (value) => validateReviewerResult(value, task, 'a'.repeat(40)) }), /turn/u);
});

test('SDK loader requires exact package version and exported query function', async () => {
  const loaded = await loadClaudeAgentSdk({
    importer: async () => ({ query: () => 'iterable' }),
    resolveEntry: () => '/virtual/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    readPackageMetadata: async () => ({ name: '@anthropic-ai/claude-agent-sdk', version: '0.3.232' }),
  });
  assert.equal(loaded.version, '0.3.232');
  assert.equal(typeof loaded.query, 'function');
  await assert.rejects(() => loadClaudeAgentSdk({ importer: async () => ({ query() {} }), resolveEntry: () => '/x', readPackageMetadata: async () => ({ name: '@anthropic-ai/claude-agent-sdk', version: '0.3.231' }) }), /version/u);
  await assert.rejects(() => loadClaudeAgentSdk({ importer: async () => ({}), resolveEntry: () => '/x', readPackageMetadata: async () => ({ name: '@anthropic-ai/claude-agent-sdk', version: '0.3.232' }) }), /query/u);
  await assert.rejects(() => loadClaudeAgentSdk({ importer: async () => { throw new Error('missing'); }, resolveEntry: () => '/x', readPackageMetadata: async () => ({}) }), /unavailable/u);
});
