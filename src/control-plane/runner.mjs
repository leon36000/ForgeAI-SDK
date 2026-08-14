import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizedTaskEnvelope, taskEnvelopeHash, validateTaskEnvelope } from '../contracts.mjs';
import { buildArtifactManifest, sealEvidenceBundle, verifyArtifactManifest } from '../evidence.mjs';
import { runRequiredGates } from '../gate-runner.mjs';
import { inspectGitState, verifyGitScope } from '../git-proof.mjs';
import { appendLedgerEvent, initializeLedger, verifyLedger } from '../ledger.mjs';
import { evaluateProof } from '../proof.mjs';
import { atomicWriteJson, hashCanonical, isPlainObject } from '../utils.mjs';
import {
  CONTROL_PLANE_RESULT_SCHEMA_VERSION,
  SUPPORTED_CLAUDE_AGENT_SDK,
} from './constants.mjs';
import {
  normalizeControlPlanePolicy,
  validateControlPlaneTaskQualification,
  validateReviewerResult,
  validateWriterResult,
} from './contracts.mjs';
import {
  buildReviewerOptions,
  buildWriterOptions,
  invokeStructuredAgent,
  loadClaudeAgentSdk,
} from './sdk-adapter.mjs';
import { buildReviewerPrompt, buildWriterPrompt } from './prompts.mjs';

function instant(now) {
  const value = now();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('control-plane clock must return an ISO timestamp');
  return value;
}

function finding(code, message, details = {}) {
  return Object.freeze({ code, message, ...details });
}

function createPaths(task) {
  const runtime = resolve(task.workspace, '.forgeai', 'runtime');
  const ledger = resolve(task.workspace, '.forgeai', 'ledger', task.task_id);
  const evidence = resolve(task.evidence_dir);
  return Object.freeze({
    runtime,
    ledger,
    evidence_dir: evidence,
    artifacts: join(evidence, 'artifacts'),
    task: join(runtime, 'current-task.json'),
    reviewer_task: join(runtime, 'reviewer-task.json'),
    evidence: join(evidence, 'evidence-bundle.json'),
    proof: join(runtime, 'latest-proof.json'),
    result: join(runtime, 'control-plane-result.json'),
  });
}

function publicInvocation(invocation, model) {
  if (!invocation) return null;
  return Object.freeze({
    model,
    session_id: invocation.session_id,
    total_cost_usd: invocation.total_cost_usd,
    num_turns: invocation.num_turns,
    duration_ms: invocation.duration_ms,
    message_types: invocation.message_types,
    structured_output: invocation.structured_output,
  });
}

async function persistResult(paths, result) {
  if (paths?.result) await atomicWriteJson(paths.result, result);
  return Object.freeze(result);
}

function derivedReviewerTask(task) {
  return normalizedTaskEnvelope({
    ...structuredClone(task),
    role: 'reviewer',
    mode: 'REVIEW',
    allowed_mcp_tools: [],
    execution: {
      harness: 'claude-agent-sdk',
      qualified: true,
      sandbox_required: false,
      sandbox_verified: false,
    },
  });
}

function evidenceFinding(item) {
  return {
    severity: item.severity,
    status: item.status,
    code: item.code,
    ...(item.path === undefined ? {} : { path: item.path }),
    message: item.message,
    evidence_hash: hashCanonical(item),
    resolution: item.resolution,
  };
}

export async function runControlPlane({
  task: taskValue,
  policy: policyValue,
  query = undefined,
  sdkVersion = undefined,
  loadSdk = loadClaudeAgentSdk,
  now = () => new Date().toISOString(),
} = {}) {
  let task;
  let policy;
  let paths = null;
  let phase = 'contract';
  let writer = null;
  let reviewer = null;
  let gates = [];
  let proof = null;
  let ledgerReady = false;
  const startedAt = instant(now);
  const runFindings = [];

  const finishBlocked = async (code, message, details = {}) => {
    runFindings.push(finding(code, message, details));
    if (ledgerReady) {
      try {
        await appendLedgerEvent(paths.ledger, {
          type: 'CONTROL_PLANE_BLOCKED',
          actor: 'forgeai-control-plane',
          task_id: task.task_id,
          payload: { phase, code, message },
        });
      } catch (error) {
        runFindings.push(finding('LEDGER_BLOCKED_EVENT_FAILED', error.message));
      }
    }
    const result = {
      schema_version: CONTROL_PLANE_RESULT_SCHEMA_VERSION,
      verdict: 'BLOCKED',
      phase,
      task_id: task?.task_id ?? null,
      task_envelope_hash: task ? taskEnvelopeHash(task) : null,
      sdk: policy?.sdk ?? null,
      writer: publicInvocation(writer, policy?.writer?.model),
      reviewer: publicInvocation(reviewer, policy?.reviewer?.model),
      gates,
      proof,
      total_cost_usd: (writer?.total_cost_usd ?? 0) + (reviewer?.total_cost_usd ?? 0),
      findings: runFindings,
      paths,
      started_at: startedAt,
      finished_at: instant(now),
    };
    return persistResult(paths, result);
  };

  try {
    validateTaskEnvelope(taskValue);
    task = normalizedTaskEnvelope(taskValue);
    policy = normalizeControlPlanePolicy(policyValue);
    paths = createPaths(task);
    await mkdir(paths.runtime, { recursive: true, mode: 0o700 });
    await mkdir(paths.evidence_dir, { recursive: true, mode: 0o700 });
    await mkdir(paths.artifacts, { recursive: true, mode: 0o700 });
    await rm(paths.proof, { force: true });
    await atomicWriteJson(paths.task, task);
    await initializeLedger(paths.ledger);
    ledgerReady = true;
    await appendLedgerEvent(paths.ledger, {
      type: 'CONTROL_PLANE_STARTED',
      actor: 'forgeai-control-plane',
      task_id: task.task_id,
      payload: {
        task_envelope_hash: taskEnvelopeHash(task),
        sdk: policy.sdk,
        writer_model: policy.writer.model,
        reviewer_model: policy.reviewer.model,
      },
    });
  } catch (error) {
    return finishBlocked('CONTROL_PLANE_CONTRACT_INVALID', error.message);
  }

  phase = 'qualification';
  if (!['R0', 'R1'].includes(task.risk)) {
    return finishBlocked('RISK_NOT_SUPPORTED', `control-plane alpha supports R0 and R1 only; received ${task.risk}`);
  }
  try {
    validateControlPlaneTaskQualification(task, policy);
  } catch (error) {
    return finishBlocked('TASK_NOT_QUALIFIED', error.message);
  }

  let sdkQuery = query;
  let actualSdkVersion = sdkVersion;
  phase = 'sdk';
  if (typeof sdkQuery !== 'function') {
    try {
      const loaded = await loadSdk();
      sdkQuery = loaded.query;
      actualSdkVersion = loaded.version;
    } catch (error) {
      return finishBlocked('SDK_UNAVAILABLE', error.message);
    }
  }
  if (actualSdkVersion !== policy.sdk.version || policy.sdk.package !== SUPPORTED_CLAUDE_AGENT_SDK.package) {
    return finishBlocked('SDK_VERSION_MISMATCH', `expected ${policy.sdk.package}@${policy.sdk.version}, got ${actualSdkVersion ?? 'unknown'}`);
  }

  let decisionQueue = Promise.resolve();
  const recordToolDecision = (stage) => (decision) => {
    decisionQueue = decisionQueue.then(() => appendLedgerEvent(paths.ledger, {
      type: 'CONTROL_PLANE_TOOL_DECISION',
      actor: `claude-agent-sdk:${stage}`,
      task_id: task.task_id,
      payload: {
        stage,
        tool_name: decision.tool_name,
        allowed: decision.allowed,
        code: decision.code,
        reason: decision.reason,
      },
    }));
    return decisionQueue;
  };

  phase = 'writer';
  try {
    const options = buildWriterOptions(task, policy, {
      taskEnvelopePath: paths.task,
      ledgerDir: paths.ledger,
      proofPath: paths.proof,
      onToolDecision: recordToolDecision('writer'),
    });
    writer = await invokeStructuredAgent({
      query: sdkQuery,
      prompt: buildWriterPrompt(task),
      options,
      validate: (value) => validateWriterResult(value, task),
    });
    await decisionQueue;
    await appendLedgerEvent(paths.ledger, {
      type: 'CONTROL_PLANE_WRITER_COMPLETED',
      actor: `claude-agent-sdk:${writer.session_id}`,
      task_id: task.task_id,
      payload: {
        session_id: writer.session_id,
        model: policy.writer.model,
        status: writer.structured_output.status,
        output_hash: hashCanonical(writer.structured_output),
        cost_usd: writer.total_cost_usd,
        turns: writer.num_turns,
      },
    });
  } catch (error) {
    return finishBlocked('WRITER_SDK_ERROR', error.message);
  }
  if (writer.structured_output.status !== 'READY_FOR_REVIEW') return finishBlocked('WRITER_BLOCKED', writer.structured_output.summary);

  phase = 'git';
  let gitState;
  let gitScope;
  try {
    gitState = inspectGitState(task.workspace, task.base_commit, writer.structured_output.final_commit);
  } catch (error) {
    const head = (() => {
      try { return inspectGitState(task.workspace, task.base_commit).head; }
      catch { return null; }
    })();
    return finishBlocked('WRITER_COMMIT_MISMATCH', error.message, { reported_commit: writer.structured_output.final_commit, actual_head: head });
  }
  gitScope = verifyGitScope(gitState, task);
  if (!gitScope.valid) {
    runFindings.push(...gitScope.findings.map((item) => finding(item.code, item.message ?? 'Git scope verification failed', item)));
    return finishBlocked('GIT_SCOPE_BLOCKED', 'fresh Git scope verification failed');
  }

  phase = 'gates';
  try {
    const categories = {};
    if (task.task_kind === 'bugfix') categories[task.required_test_commands[0]] = 'regression';
    gates = await runRequiredGates(task, { categories });
  } catch (error) {
    return finishBlocked('GATES_ERROR', error.message);
  }
  await appendLedgerEvent(paths.ledger, {
    type: 'CONTROL_PLANE_GATES_COMPLETED',
    actor: 'forgeai-foundation',
    task_id: task.task_id,
    payload: {
      count: gates.length,
      statuses: gates.map((gate) => ({ id: gate.id, status: gate.status, exit_code: gate.exit_code })),
    },
  });
  if (gates.length !== task.required_test_commands.length || gates.some((gate) => gate.status !== 'PASS' || gate.exit_code !== 0)) {
    return finishBlocked('GATES_BLOCKED', 'one or more required deterministic gates did not pass');
  }
  try {
    gitState = inspectGitState(task.workspace, task.base_commit, writer.structured_output.final_commit);
  } catch (error) {
    return finishBlocked('POST_GATE_GIT_CHANGED', error.message);
  }

  phase = 'reviewer';
  const reviewerTask = derivedReviewerTask(task);
  await atomicWriteJson(paths.reviewer_task, reviewerTask);
  const reviewPacket = Object.freeze({
    task_id: task.task_id,
    task_envelope_hash: taskEnvelopeHash(task),
    final_commit: gitState.final_commit,
    changed_files: gitState.changed_files,
    gates: gates.map((gate) => ({ id: gate.id, category: gate.category, command: gate.command, status: gate.status, exit_code: gate.exit_code, stdout_sha256: gate.stdout_sha256, stderr_sha256: gate.stderr_sha256 })),
    writer: writer.structured_output,
  });
  try {
    const options = buildReviewerOptions(reviewerTask, policy, {
      taskEnvelopePath: paths.reviewer_task,
      ledgerDir: paths.ledger,
      proofPath: paths.proof,
      onToolDecision: recordToolDecision('reviewer'),
    });
    reviewer = await invokeStructuredAgent({
      query: sdkQuery,
      prompt: buildReviewerPrompt(task, reviewPacket),
      options,
      validate: (value) => validateReviewerResult(value, task, gitState.final_commit),
    });
    await decisionQueue;
  } catch (error) {
    return finishBlocked('REVIEWER_SDK_ERROR', error.message);
  }
  if (reviewer.session_id === writer.session_id || reviewer.session_id === task.metadata.writer_session_id) {
    return finishBlocked('REVIEW_SESSION_NOT_FRESH', 'reviewer session must differ from both actual and logical writer sessions');
  }
  await appendLedgerEvent(paths.ledger, {
    type: 'CONTROL_PLANE_REVIEWER_COMPLETED',
    actor: `claude-agent-sdk:${reviewer.session_id}`,
    task_id: task.task_id,
    payload: {
      session_id: reviewer.session_id,
      model: policy.reviewer.model,
      verdict: reviewer.structured_output.verdict,
      output_hash: hashCanonical(reviewer.structured_output),
      cost_usd: reviewer.total_cost_usd,
      turns: reviewer.num_turns,
      final_commit: reviewer.structured_output.final_commit,
    },
  });

  const totalCost = writer.total_cost_usd + reviewer.total_cost_usd;
  if (totalCost > policy.max_total_budget_usd) return finishBlocked('TOTAL_BUDGET_EXCEEDED', `actual cost ${totalCost} exceeds ${policy.max_total_budget_usd}`);
  try {
    gitState = inspectGitState(task.workspace, task.base_commit, writer.structured_output.final_commit);
  } catch (error) {
    return finishBlocked('POST_REVIEW_GIT_CHANGED', error.message);
  }
  gitScope = verifyGitScope(gitState, task);
  if (!gitScope.valid) {
    runFindings.push(...gitScope.findings.map((item) => finding(item.code, item.message ?? 'Git scope verification failed', item)));
    return finishBlocked('POST_REVIEW_SCOPE_BLOCKED', 'Git scope changed during review');
  }

  phase = 'proof';
  try {
    await appendLedgerEvent(paths.ledger, {
      type: 'CONTROL_PLANE_EVIDENCE_READY',
      actor: 'forgeai-control-plane',
      task_id: task.task_id,
      payload: {
        final_commit: gitState.final_commit,
        review_packet_hash: hashCanonical(reviewPacket),
      },
    });
    const ledgerVerification = await verifyLedger(paths.ledger);
    const artifacts = await buildArtifactManifest(paths.artifacts);
    const evidenceDraft = {
      task_id: task.task_id,
      task_envelope_hash: taskEnvelopeHash(task),
      base_commit: task.base_commit,
      final_commit: gitState.final_commit,
      generated_at: instant(now),
      changed_files: gitState.changed_files,
      git: { head: gitState.head, clean: gitState.clean, base_is_ancestor: true },
      gates,
      acceptance: writer.structured_output.acceptance,
      reviews: [{
        role: 'reviewer',
        model: policy.reviewer.model,
        session_id: reviewer.session_id,
        verdict: reviewer.structured_output.verdict,
        context_fresh: true,
        findings_count: reviewer.structured_output.findings.length,
        evidence_hash: hashCanonical(reviewer.structured_output),
        final_commit: gitState.final_commit,
      }],
      findings: [...writer.structured_output.findings, ...reviewer.structured_output.findings].map(evidenceFinding),
      artifacts,
      ledger_head: { count: ledgerVerification.count, last_hash: ledgerVerification.last_hash },
      human_approval: null,
    };
    const evidence = sealEvidenceBundle(evidenceDraft);
    await atomicWriteJson(paths.evidence, evidence);
    const artifactVerification = await verifyArtifactManifest(paths.artifacts, evidence.artifacts);
    proof = evaluateProof(task, evidence, {
      ledgerVerification,
      gitState,
      gitScope,
      artifactVerification,
    });
    await atomicWriteJson(paths.proof, proof);
  } catch (error) {
    return finishBlocked('PROOF_ERROR', error.message);
  }

  const result = {
    schema_version: CONTROL_PLANE_RESULT_SCHEMA_VERSION,
    verdict: proof.verdict,
    phase: 'proof',
    task_id: task.task_id,
    task_envelope_hash: taskEnvelopeHash(task),
    sdk: policy.sdk,
    writer: publicInvocation(writer, policy.writer.model),
    reviewer: publicInvocation(reviewer, policy.reviewer.model),
    gates,
    proof,
    total_cost_usd: totalCost,
    findings: proof.findings,
    paths,
    started_at: startedAt,
    finished_at: instant(now),
  };
  return persistResult(paths, result);
}

export function isControlPlaneResult(value) {
  return isPlainObject(value) && value.schema_version === CONTROL_PLANE_RESULT_SCHEMA_VERSION && ['PASS', 'BLOCKED'].includes(value.verdict);
}
