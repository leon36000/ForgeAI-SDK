import { basename } from 'node:path';
import { parseCommandLine } from '../command.mjs';
import { matchesAny } from '../glob.mjs';
import { validateTaskEnvelope } from '../contracts.mjs';
import {
  assertOnlyKeys,
  assertSafeText,
  canonicalize,
  isPlainObject,
} from '../utils.mjs';
import {
  CONTROL_PLANE_LIMITS,
  CONTROL_PLANE_POLICY_SCHEMA_VERSION,
  REVIEWER_RESULT_SCHEMA_VERSION,
  SUPPORTED_CLAUDE_AGENT_SDK,
  WRITER_RESULT_SCHEMA_VERSION,
} from './constants.mjs';
import policySchema from '../../schemas/control-plane-policy-v0.2.0-alpha.1.schema.json' with { type: 'json' };
import writerSchema from '../../schemas/writer-result-v0.2.0-alpha.1.schema.json' with { type: 'json' };
import reviewerSchema from '../../schemas/reviewer-result-v0.2.0-alpha.1.schema.json' with { type: 'json' };

const POLICY_KEYS = ['schema_version', 'sdk', 'writer', 'reviewer', 'max_total_budget_usd'];
const SDK_KEYS = ['package', 'version'];
const ROLE_KEYS = ['model', 'max_turns', 'max_budget_usd'];
const WRITER_KEYS = ['schema_version', 'status', 'summary', 'final_commit', 'acceptance', 'findings'];
const REVIEWER_KEYS = ['schema_version', 'verdict', 'summary', 'final_commit', 'findings'];
const ACCEPTANCE_KEYS = ['id', 'status', 'evidence'];
const FINDING_KEYS = ['severity', 'status', 'code', 'path', 'message', 'resolution'];
const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function safeBoundedText(value, label, max) {
  assertSafeText(value, label);
  if (value.length > max) throw new Error(`${label} must contain at most ${max} characters`);
  return value;
}

function validateRolePolicy(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  assertOnlyKeys(value, ROLE_KEYS, label);
  safeBoundedText(value.model, `${label}.model`, 256);
  if (!Number.isInteger(value.max_turns) || value.max_turns < 1 || value.max_turns > CONTROL_PLANE_LIMITS.max_turns) {
    throw new Error(`${label}.max_turns must be between 1 and ${CONTROL_PLANE_LIMITS.max_turns}`);
  }
  if (!Number.isFinite(value.max_budget_usd) || value.max_budget_usd <= 0 || value.max_budget_usd > CONTROL_PLANE_LIMITS.max_role_budget_usd) {
    throw new Error(`${label}.max_budget_usd must be greater than 0 and at most ${CONTROL_PLANE_LIMITS.max_role_budget_usd}`);
  }
}

export function validateControlPlanePolicy(policy) {
  if (!isPlainObject(policy)) throw new TypeError('control-plane policy must be a plain object');
  assertOnlyKeys(policy, POLICY_KEYS, 'control-plane policy');
  if (policy.schema_version !== CONTROL_PLANE_POLICY_SCHEMA_VERSION) throw new Error(`unsupported control-plane policy schema: ${policy.schema_version}`);
  if (!isPlainObject(policy.sdk)) throw new TypeError('control-plane policy sdk must be a plain object');
  assertOnlyKeys(policy.sdk, SDK_KEYS, 'control-plane policy sdk');
  if (policy.sdk.package !== SUPPORTED_CLAUDE_AGENT_SDK.package || policy.sdk.version !== SUPPORTED_CLAUDE_AGENT_SDK.version) {
    throw new Error(`unsupported Claude Agent SDK: ${policy.sdk.package}@${policy.sdk.version}`);
  }
  validateRolePolicy(policy.writer, 'writer');
  validateRolePolicy(policy.reviewer, 'reviewer');
  if (!Number.isFinite(policy.max_total_budget_usd) || policy.max_total_budget_usd <= 0 || policy.max_total_budget_usd > CONTROL_PLANE_LIMITS.max_total_budget_usd) {
    throw new Error(`max_total_budget_usd must be greater than 0 and at most ${CONTROL_PLANE_LIMITS.max_total_budget_usd}`);
  }
  const roleTotal = policy.writer.max_budget_usd + policy.reviewer.max_budget_usd;
  if (roleTotal > policy.max_total_budget_usd) throw new Error('role budgets exceed max total budget');
  return policy;
}

export function normalizeControlPlanePolicy(policy) {
  validateControlPlanePolicy(policy);
  return Object.freeze(structuredClone(policy));
}

const DIRECT_NETWORK_EXECUTABLES = new Set([
  'curl', 'wget', 'ftp', 'sftp', 'scp', 'ssh', 'telnet', 'nc', 'ncat', 'netcat', 'rsync',
]);
const PACKAGE_NETWORK_SUBCOMMANDS = new Set([
  'add', 'ci', 'install', 'login', 'logout', 'pack', 'publish', 'update', 'upgrade',
]);
const GIT_NETWORK_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push', 'remote', 'submodule']);
const URL_ARGUMENT_RE = /(?:^|[^A-Za-z0-9+.-])https?:\/\//iu;

function normalizedExecutable(value) {
  return basename(value).toLowerCase().replace(/\.exe$/u, '');
}

function networkCapableCommandReason(command) {
  const argv = parseCommandLine(command);
  const executable = normalizedExecutable(argv[0]);
  const subcommand = argv[1]?.toLowerCase();
  if (DIRECT_NETWORK_EXECUTABLES.has(executable)) return `${executable} is network-capable`;
  if (['npx', 'pnpx'].includes(executable)) return `${executable} may fetch and execute remote packages`;
  if (executable === 'git' && GIT_NETWORK_SUBCOMMANDS.has(subcommand)) return `git ${subcommand} is network-capable`;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable) && PACKAGE_NETWORK_SUBCOMMANDS.has(subcommand)) {
    return `${executable} ${subcommand} is network-capable`;
  }
  if (argv.some((argument) => URL_ARGUMENT_RE.test(argument))) return 'command contains an HTTP(S) target';
  return null;
}

export function validateControlPlaneTaskQualification(taskValue, policyValue) {
  validateTaskEnvelope(taskValue);
  const task = structuredClone(taskValue);
  const policy = normalizeControlPlanePolicy(policyValue);
  if (task.role !== 'writer' || task.mode !== 'EXECUTE') throw new Error('control-plane alpha requires a writer EXECUTE task');
  if (task.execution.harness !== 'claude-agent-sdk') throw new Error('control-plane alpha requires the claude-agent-sdk harness');
  if (task.delegation.agent_depth !== 0 || task.delegation.max_parallel_agents !== 1 || task.delegation.allow_nested_agents !== false) {
    throw new Error('control-plane alpha requires exactly one writer and forbids nested agents');
  }
  if (task.metadata.writer_model !== policy.writer.model) throw new Error('task writer model must match the control-plane writer model');
  if (!SHA_RE.test(task.base_commit)) throw new Error('control-plane alpha requires base_commit to be a full Git SHA');
  if (task.allowed_mcp_tools.length !== 0) throw new Error('control-plane alpha forbids MCP tools during EXECUTE');
  if (task.allowed_network_hosts.length !== 0) throw new Error('control-plane alpha forbids declared network hosts during EXECUTE');
  for (const command of task.allowed_bash_commands) {
    const reason = networkCapableCommandReason(command);
    if (reason) throw new Error(`control-plane alpha forbids network-capable command: ${reason}`);
  }
  return Object.freeze(task);
}

function safeRelativePath(value, label, task) {
  if (value === undefined) return undefined;
  safeBoundedText(value, label, 1024);
  if (value.startsWith('/') || value.split('/').includes('..') || /[\u0000\u000a\u000d]/u.test(value)) throw new Error(`${label} is invalid`);
  if (!matchesAny(value, task.allowed_paths) || matchesAny(value, task.denied_paths)) throw new Error(`${label} is outside task scope`);
  return value;
}

function validateFinding(value, label, task) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  assertOnlyKeys(value, FINDING_KEYS, label);
  if (!Object.hasOwn(SEVERITY_RANK, value.severity)) throw new Error(`${label}.severity is invalid`);
  if (!['OPEN', 'RESOLVED', 'ACCEPTED_RISK', 'REJECTED'].includes(value.status)) throw new Error(`${label}.status is invalid`);
  safeBoundedText(value.code, `${label}.code`, 128);
  safeRelativePath(value.path, `${label}.path`, task);
  safeBoundedText(value.message, `${label}.message`, CONTROL_PLANE_LIMITS.max_message_chars);
  if (typeof value.resolution !== 'string' || value.resolution.length > CONTROL_PLANE_LIMITS.max_message_chars || /[\u0000\u000a\u000d]/u.test(value.resolution)) {
    throw new Error(`${label}.resolution must be a bounded single-line string`);
  }
  return value;
}

function validateFindings(value, label, task) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > CONTROL_PLANE_LIMITS.max_findings) throw new Error(`${label} must contain at most ${CONTROL_PLANE_LIMITS.max_findings} items`);
  return value.map((finding, index) => validateFinding(finding, `${label}[${index}]`, task));
}

function validateFullSha(value, label) {
  if (typeof value !== 'string' || !SHA_RE.test(value)) throw new Error(`${label} must be a full Git SHA`);
  return value;
}

function blockingFinding(findings) {
  return findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.high && finding.status !== 'RESOLVED');
}

export function validateWriterResult(result, task) {
  validateTaskEnvelope(task);
  if (!isPlainObject(result)) throw new TypeError('writer result must be a plain object');
  assertOnlyKeys(result, WRITER_KEYS, 'writer result');
  if (result.schema_version !== WRITER_RESULT_SCHEMA_VERSION) throw new Error(`unsupported writer result schema: ${result.schema_version}`);
  if (!['READY_FOR_REVIEW', 'BLOCKED'].includes(result.status)) throw new Error('writer result status is invalid');
  safeBoundedText(result.summary, 'writer result summary', CONTROL_PLANE_LIMITS.max_summary_chars);
  validateFullSha(result.final_commit, 'writer result final_commit');
  if (!Array.isArray(result.acceptance)) throw new TypeError('writer result acceptance must be an array');
  const expectedIds = task.acceptance_criteria.map((criterion) => criterion.id).sort();
  const actualIds = result.acceptance.map((item) => item?.id).sort();
  if (canonicalize(expectedIds) !== canonicalize(actualIds)) throw new Error('writer result acceptance ids must exactly match task acceptance ids');
  for (const [index, item] of result.acceptance.entries()) {
    if (!isPlainObject(item)) throw new TypeError(`writer result acceptance[${index}] must be a plain object`);
    assertOnlyKeys(item, ACCEPTANCE_KEYS, `writer result acceptance[${index}]`);
    safeBoundedText(item.id, `writer result acceptance[${index}].id`, 32);
    if (!['PASS', 'BLOCKED'].includes(item.status)) throw new Error(`writer result acceptance[${index}].status is invalid`);
    safeBoundedText(item.evidence, `writer result acceptance[${index}].evidence`, CONTROL_PLANE_LIMITS.max_evidence_chars);
  }
  const findings = validateFindings(result.findings, 'writer result findings', task);
  if (result.status === 'READY_FOR_REVIEW' && (result.acceptance.some((item) => item.status !== 'PASS') || blockingFinding(findings))) {
    throw new Error('READY_FOR_REVIEW requires passing acceptance and no unresolved high or critical finding');
  }
  return Object.freeze(structuredClone(result));
}

export function validateReviewerResult(result, task, finalCommit) {
  validateTaskEnvelope(task);
  validateFullSha(finalCommit, 'expected final_commit');
  if (!isPlainObject(result)) throw new TypeError('reviewer result must be a plain object');
  assertOnlyKeys(result, REVIEWER_KEYS, 'reviewer result');
  if (result.schema_version !== REVIEWER_RESULT_SCHEMA_VERSION) throw new Error(`unsupported reviewer result schema: ${result.schema_version}`);
  if (!['PASS', 'BLOCKED'].includes(result.verdict)) throw new Error('reviewer result verdict is invalid');
  safeBoundedText(result.summary, 'reviewer result summary', CONTROL_PLANE_LIMITS.max_summary_chars);
  validateFullSha(result.final_commit, 'reviewer result final_commit');
  if (result.final_commit !== finalCommit) throw new Error('reviewer result final_commit does not match the reviewed commit');
  const findings = validateFindings(result.findings, 'reviewer result findings', task);
  const expectedVerdict = blockingFinding(findings) ? 'BLOCKED' : 'PASS';
  if (result.verdict !== expectedVerdict) throw new Error(`reviewer result verdict must be ${expectedVerdict}`);
  return Object.freeze(structuredClone(result));
}

export const CONTROL_PLANE_POLICY_SCHEMA = Object.freeze(policySchema);
export const WRITER_OUTPUT_SCHEMA = Object.freeze(writerSchema);
export const REVIEWER_OUTPUT_SCHEMA = Object.freeze(reviewerSchema);
