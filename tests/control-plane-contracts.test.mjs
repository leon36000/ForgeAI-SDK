import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTROL_PLANE_POLICY_SCHEMA_VERSION,
  REVIEWER_RESULT_SCHEMA_VERSION,
  WRITER_RESULT_SCHEMA_VERSION,
  SUPPORTED_CLAUDE_AGENT_SDK,
} from '../src/control-plane/constants.mjs';
import {
  CONTROL_PLANE_POLICY_SCHEMA,
  normalizeControlPlanePolicy,
  REVIEWER_OUTPUT_SCHEMA,
  validateControlPlanePolicy,
  validateControlPlaneTaskQualification,
  validateReviewerResult,
  validateWriterResult,
  WRITER_OUTPUT_SCHEMA,
} from '../src/control-plane/contracts.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

function policy(overrides = {}) {
  return {
    schema_version: CONTROL_PLANE_POLICY_SCHEMA_VERSION,
    sdk: { ...SUPPORTED_CLAUDE_AGENT_SDK },
    writer: { model: 'claude-sonnet-5', max_turns: 24, max_budget_usd: 4 },
    reviewer: { model: 'claude-sonnet-5', max_turns: 12, max_budget_usd: 2 },
    max_total_budget_usd: 6,
    ...overrides,
  };
}

function writerResult(task, overrides = {}) {
  return {
    schema_version: WRITER_RESULT_SCHEMA_VERSION,
    status: 'READY_FOR_REVIEW',
    summary: 'Implemented and committed the bounded change.',
    final_commit: 'a'.repeat(40),
    acceptance: task.acceptance_criteria.map((criterion) => ({ id: criterion.id, status: 'PASS', evidence: 'required gate evidence' })),
    findings: [],
    ...overrides,
  };
}

function reviewerResult(overrides = {}) {
  return {
    schema_version: REVIEWER_RESULT_SCHEMA_VERSION,
    verdict: 'PASS',
    summary: 'No load-bearing finding remains open.',
    final_commit: 'a'.repeat(40),
    findings: [],
    ...overrides,
  };
}

test('control-plane policy validates and normalizes exact SDK identity', () => {
  const value = normalizeControlPlanePolicy(policy());
  assert.equal(value.sdk.package, '@anthropic-ai/claude-agent-sdk');
  assert.equal(value.sdk.version, '0.3.232');
  assert.equal(value.max_total_budget_usd, 6);
  assert.ok(Object.isFrozen(value));
});

test('control-plane policy rejects unknown keys and budget inconsistency', () => {
  assert.throws(() => validateControlPlanePolicy(policy({ extra: true })), /unexpected keys/u);
  assert.throws(() => validateControlPlanePolicy(policy({ max_total_budget_usd: 5 })), /total budget/u);
});

test('control-plane policy rejects unsupported SDK and unbounded values', () => {
  assert.throws(() => validateControlPlanePolicy(policy({ sdk: { package: '@anthropic-ai/claude-agent-sdk', version: '0.3.999' } })), /unsupported Claude Agent SDK/u);
  assert.throws(() => validateControlPlanePolicy(policy({ writer: { model: 'claude-sonnet-5', max_turns: 0, max_budget_usd: 4 } })), /max_turns/u);
  assert.throws(() => validateControlPlanePolicy(policy({ reviewer: { model: 'claude-sonnet-5', max_turns: 12, max_budget_usd: Infinity } })), /max_budget_usd/u);
});


test('control-plane task qualification enforces exact harness, single writer, and model binding', async () => {
  const task = sampleTask(await tempWorkspace(), {
    execution: { harness: 'claude-agent-sdk', qualified: true, sandbox_required: true, sandbox_verified: true },
    allowed_mcp_tools: [],
    allowed_network_hosts: [],
    metadata: { writer_model: 'claude-sonnet-5', writer_session_id: 'logical-writer-session' },
  });
  assert.equal(validateControlPlaneTaskQualification(task, policy()).task_id, task.task_id);
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(task), execution: { ...task.execution, harness: 'other' } }, policy()), /harness/u);
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(task), delegation: { ...task.delegation, max_parallel_agents: 2 } }, policy()), /one writer/u);
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(task), metadata: { ...task.metadata, writer_model: 'different' } }, policy()), /writer model/u);
});

test('control-plane task qualification refuses MCP, network declarations, and known network commands', async () => {
  const base = sampleTask(await tempWorkspace(), {
    execution: { harness: 'claude-agent-sdk', qualified: true, sandbox_required: true, sandbox_verified: true },
    allowed_mcp_tools: [],
    allowed_network_hosts: [],
    metadata: { writer_model: 'claude-sonnet-5', writer_session_id: 'logical-writer-session' },
  });
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(base), allowed_mcp_tools: ['mcp__litellm__consult'] }, policy()), /MCP/u);
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(base), allowed_network_hosts: ['example.com'] }, policy()), /network/u);
  const command = 'curl https://example.com';
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(base), allowed_bash_commands: [command], required_test_commands: [command] }, policy()), /network-capable/u);
});

test('control-plane task qualification rejects partial SHAs and network-capable package or Git commands', async () => {
  const base = sampleTask(await tempWorkspace(), {
    execution: { harness: 'claude-agent-sdk', qualified: true, sandbox_required: true, sandbox_verified: true },
    allowed_mcp_tools: [],
    allowed_network_hosts: [],
    metadata: { writer_model: 'claude-sonnet-5', writer_session_id: 'logical-writer-session' },
  });
  assert.throws(() => validateControlPlaneTaskQualification({ ...structuredClone(base), base_commit: 'abcdef0' }, policy()), /full Git SHA/u);
  for (const command of ['npx eslint .', 'npm install', 'git fetch origin', 'node script.mjs https://example.com']) {
    assert.throws(
      () => validateControlPlaneTaskQualification({ ...structuredClone(base), allowed_bash_commands: [command], required_test_commands: [command] }, policy()),
      /network-capable/u,
      command,
    );
  }
});

test('writer result covers every acceptance criterion exactly once', async () => {
  const task = sampleTask(await tempWorkspace());
  assert.equal(validateWriterResult(writerResult(task), task).status, 'READY_FOR_REVIEW');
  assert.throws(() => validateWriterResult(writerResult(task, { acceptance: [] }), task), /acceptance ids/u);
  assert.throws(() => validateWriterResult(writerResult(task, { acceptance: [{ id: 'OTHER', status: 'PASS', evidence: 'x' }] }), task), /acceptance ids/u);
});

test('writer READY result requires a full SHA and passing acceptance', async () => {
  const task = sampleTask(await tempWorkspace());
  assert.throws(() => validateWriterResult(writerResult(task, { final_commit: 'abc1234' }), task), /final_commit/u);
  assert.throws(() => validateWriterResult(writerResult(task, { acceptance: [{ id: 'AC1', status: 'BLOCKED', evidence: 'failed' }] }), task), /READY_FOR_REVIEW/u);
});

test('reviewer result is bound to final commit and verdict matches blocking findings', async () => {
  const task = sampleTask(await tempWorkspace());
  assert.equal(validateReviewerResult(reviewerResult(), task, 'a'.repeat(40)).verdict, 'PASS');
  assert.throws(() => validateReviewerResult(reviewerResult({ final_commit: 'b'.repeat(40) }), task, 'a'.repeat(40)), /final_commit/u);
  assert.throws(() => validateReviewerResult(reviewerResult({ findings: [{ severity: 'high', status: 'OPEN', code: 'BYPASS', path: 'src/index.js', message: 'Guard can be bypassed.', resolution: '' }] }), task, 'a'.repeat(40)), /verdict must be BLOCKED/u);
});

test('reviewer result rejects out-of-scope finding paths and excessive findings', async () => {
  const task = sampleTask(await tempWorkspace());
  assert.throws(() => validateReviewerResult(reviewerResult({ verdict: 'BLOCKED', findings: [{ severity: 'high', status: 'OPEN', code: 'OUTSIDE', path: '../outside', message: 'Outside path.', resolution: '' }] }), task, 'a'.repeat(40)), /path/u);
  const findings = Array.from({ length: 65 }, (_, index) => ({ severity: 'low', status: 'OPEN', code: `L${index}`, path: 'src/index.js', message: 'Bounded low finding.', resolution: '' }));
  assert.throws(() => validateReviewerResult(reviewerResult({ findings }), task, 'a'.repeat(40)), /at most/u);
});

test('runtime output schemas match the checked-in JSON schemas', async () => {
  const policySchema = JSON.parse(await readFile('schemas/control-plane-policy-v0.2.0-alpha.1.schema.json', 'utf8'));
  const writerSchema = JSON.parse(await readFile('schemas/writer-result-v0.2.0-alpha.1.schema.json', 'utf8'));
  const reviewerSchema = JSON.parse(await readFile('schemas/reviewer-result-v0.2.0-alpha.1.schema.json', 'utf8'));
  assert.deepEqual(CONTROL_PLANE_POLICY_SCHEMA, policySchema);
  assert.deepEqual(WRITER_OUTPUT_SCHEMA, writerSchema);
  assert.deepEqual(REVIEWER_OUTPUT_SCHEMA, reviewerSchema);
});
