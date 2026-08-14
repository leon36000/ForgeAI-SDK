import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runControlPlane } from '../src/control-plane/runner.mjs';
import {
  CONTROL_PLANE_POLICY_SCHEMA_VERSION,
  REVIEWER_RESULT_SCHEMA_VERSION,
  SUPPORTED_CLAUDE_AGENT_SDK,
  WRITER_RESULT_SCHEMA_VERSION,
} from '../src/control-plane/constants.mjs';
import { initGitRepo, runGit, sampleTask, tempWorkspace } from './helpers.mjs';

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

async function fixture({ requiredCommand = `${process.execPath} -e "process.exit(0)"`, allowedPaths = ['src/**', 'tests/**'] } = {}) {
  const workspace = await tempWorkspace('forgeai-control-plane-');
  const baseCommit = await initGitRepo(workspace);
  const task = sampleTask(workspace, {
    base_commit: baseCommit,
    allowed_paths: allowedPaths,
    allowed_bash_commands: [requiredCommand],
    required_test_commands: [requiredCommand],
    allowed_mcp_tools: [],
    execution: { harness: 'claude-agent-sdk', qualified: true, sandbox_required: true, sandbox_verified: true },
    metadata: { writer_model: 'claude-sonnet-5', writer_session_id: 'logical-writer-session' },
  });
  return { workspace, baseCommit, task };
}

function createFakeQuery({ task, workspace, writerSession = 'writer-sdk-session', reviewerSession = 'reviewer-sdk-session', writerStatus = 'READY_FOR_REVIEW', reviewerVerdict = 'PASS', outOfScope = false, finalCommitOverride = null, reviewerFindings = [] } = {}) {
  const calls = [];
  let reviewerCalls = 0;
  const query = ({ prompt, options }) => (async function* run() {
    calls.push({ prompt, options });
    const stage = options.env.FORGEAI_CONTROL_PLANE_STAGE;
    if (stage === 'writer') {
      const relative = outOfScope ? 'outside.txt' : 'src/control-plane-feature.js';
      await mkdir(join(workspace, 'src'), { recursive: true });
      await writeFile(join(workspace, relative), 'export const controlled = true;\n');
      runGit(workspace, ['add', relative]);
      runGit(workspace, ['commit', '-qm', 'feat: controlled change']);
      const finalCommit = runGit(workspace, ['rev-parse', 'HEAD']);
      yield { type: 'system', subtype: 'init', session_id: writerSession };
      yield {
        type: 'result', subtype: 'success', session_id: writerSession, total_cost_usd: 1.5, num_turns: 6, duration_ms: 50,
        structured_output: {
          schema_version: WRITER_RESULT_SCHEMA_VERSION,
          status: writerStatus,
          summary: writerStatus === 'READY_FOR_REVIEW' ? 'Committed the bounded change.' : 'Writer blocked.',
          final_commit: finalCommitOverride ?? finalCommit,
          acceptance: task.acceptance_criteria.map((criterion) => ({ id: criterion.id, status: writerStatus === 'READY_FOR_REVIEW' ? 'PASS' : 'BLOCKED', evidence: 'writer evidence' })),
          findings: [],
        },
      };
      return;
    }
    if (stage === 'reviewer') {
      reviewerCalls += 1;
      const finalCommit = runGit(workspace, ['rev-parse', 'HEAD']);
      yield { type: 'system', subtype: 'init', session_id: reviewerSession };
      yield {
        type: 'result', subtype: 'success', session_id: reviewerSession, total_cost_usd: 0.75, num_turns: 4, duration_ms: 30,
        structured_output: {
          schema_version: REVIEWER_RESULT_SCHEMA_VERSION,
          verdict: reviewerVerdict,
          summary: reviewerVerdict === 'PASS' ? 'Fresh read-only review passed.' : 'Review found a blocker.',
          final_commit: finalCommit,
          findings: reviewerFindings,
        },
      };
      return;
    }
    throw new Error(`unexpected stage ${stage}`);
  })();
  return { query, calls, reviewerCalls: () => reviewerCalls };
}

test('control plane runs one writer, deterministic gates, fresh reviewer, evidence, and PROOF', async () => {
  const { task, workspace } = await fixture();
  const fake = createFakeQuery({ task, workspace });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.phase, 'proof');
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.reviewerCalls(), 1);
  assert.equal(fake.calls[0].options.env.FORGEAI_CONTROL_PLANE_STAGE, 'writer');
  assert.equal(fake.calls[1].options.env.FORGEAI_CONTROL_PLANE_STAGE, 'reviewer');
  assert.deepEqual(fake.calls[0].options.tools, ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']);
  assert.deepEqual(fake.calls[1].options.allowedTools, ['Read', 'Glob', 'Grep']);
  assert.deepEqual(fake.calls[1].options.tools, ['Read', 'Glob', 'Grep']);
  for (const call of fake.calls) {
    assert.equal(call.options.sandbox.enabled, true);
    assert.equal(call.options.sandbox.failIfUnavailable, true);
    assert.equal(call.options.sandbox.allowUnsandboxedCommands, false);
    assert.deepEqual(call.options.sandbox.network.deniedDomains, ['*']);
  }
  assert.notEqual(result.writer.session_id, result.reviewer.session_id);
  assert.equal(result.total_cost_usd, 2.25);
  assert.equal(result.gates.length, 1);
  assert.equal(result.gates[0].status, 'PASS');
  assert.equal(result.proof.verdict, 'PASS');
  const proof = JSON.parse(await readFile(result.paths.proof, 'utf8'));
  const evidence = JSON.parse(await readFile(result.paths.evidence, 'utf8'));
  assert.equal(proof.final_commit, runGit(workspace, ['rev-parse', 'HEAD']));
  assert.equal(evidence.reviews[0].session_id, 'reviewer-sdk-session');
  assert.equal(evidence.reviews[0].final_commit, proof.final_commit);
  assert.equal(evidence.ledger_head.count >= 5, true);
  assert.equal(runGit(workspace, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).forgeai/**']), '');
});

test('gate failure blocks before reviewer and never writes PASS proof', async () => {
  const { task, workspace } = await fixture({ requiredCommand: `${process.execPath} -e "process.exit(7)"` });
  const fake = createFakeQuery({ task, workspace });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'gates');
  assert.equal(fake.reviewerCalls(), 0);
  assert.ok(result.findings.some((finding) => finding.code === 'GATES_BLOCKED'));
  await assert.rejects(() => readFile(result.paths.proof, 'utf8'), /ENOENT/u);
});

test('out-of-scope committed change is blocked before review', async () => {
  const { task, workspace } = await fixture({ allowedPaths: ['src/**', 'tests/**'] });
  const fake = createFakeQuery({ task, workspace, outOfScope: true });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'git');
  assert.equal(fake.reviewerCalls(), 0);
  assert.ok(result.findings.some((finding) => finding.code === 'GIT_OUT_OF_SCOPE'));
});

test('writer final commit mismatch fails closed', async () => {
  const { task, workspace } = await fixture();
  const fake = createFakeQuery({ task, workspace, finalCommitOverride: 'f'.repeat(40) });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'git');
  assert.ok(result.findings.some((finding) => finding.code === 'WRITER_COMMIT_MISMATCH'));
});

test('writer BLOCKED result stops the run', async () => {
  const { task, workspace } = await fixture();
  const fake = createFakeQuery({ task, workspace, writerStatus: 'BLOCKED' });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'writer');
  assert.equal(fake.reviewerCalls(), 0);
  assert.ok(result.findings.some((finding) => finding.code === 'WRITER_BLOCKED'));
});

test('reviewer session reuse is blocked even when structured verdict says PASS', async () => {
  const { task, workspace } = await fixture();
  const fake = createFakeQuery({ task, workspace, writerSession: 'same-session', reviewerSession: 'same-session' });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'reviewer');
  assert.ok(result.findings.some((finding) => finding.code === 'REVIEW_SESSION_NOT_FRESH'));
});

test('reviewer blocking finding produces BLOCKED evidence and PROOF', async () => {
  const { task, workspace } = await fixture();
  const findings = [{ severity: 'high', status: 'OPEN', code: 'REVIEW_BLOCKER', path: 'src/control-plane-feature.js', message: 'A blocker remains.', resolution: '' }];
  const fake = createFakeQuery({ task, workspace, reviewerVerdict: 'BLOCKED', reviewerFindings: findings });
  const result = await runControlPlane({ task, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'proof');
  assert.equal(result.proof.verdict, 'BLOCKED');
  assert.ok(result.proof.findings.some((finding) => finding.code === 'REVIEW_MISSING' || finding.code === 'LOAD_BEARING_FINDING_OPEN'));
});


test('alpha refuses R2 and R3 before any SDK invocation', async () => {
  const { task, workspace } = await fixture();
  const r2 = { ...structuredClone(task), risk: 'R2' };
  const fake = createFakeQuery({ task: r2, workspace });
  const result = await runControlPlane({ task: r2, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'qualification');
  assert.equal(fake.calls.length, 0);
  assert.ok(result.findings.some((finding) => finding.code === 'RISK_NOT_SUPPORTED'));
});

test('bugfix maps its first required gate to regression for PROOF', async () => {
  const { task, workspace } = await fixture();
  const bugfix = { ...structuredClone(task), task_kind: 'bugfix' };
  const fake = createFakeQuery({ task: bugfix, workspace });
  const result = await runControlPlane({ task: bugfix, policy: policy(), query: fake.query, sdkVersion: '0.3.232' });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.gates[0].category, 'regression');
});

test('missing SDK fails closed before writer invocation', async () => {
  const { task } = await fixture();
  const result = await runControlPlane({
    task,
    policy: policy(),
    loadSdk: async () => { throw new Error('not installed'); },
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.phase, 'sdk');
  assert.ok(result.findings.some((finding) => finding.code === 'SDK_UNAVAILABLE'));
});
