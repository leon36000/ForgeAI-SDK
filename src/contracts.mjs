import { isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalCommand, commandIdentity } from './command.mjs';
import { validateGlobPattern } from './glob.mjs';
import {
  assertArrayOfStrings,
  assertIsoDate,
  assertOnlyKeys,
  assertSafeText,
  canonicalize,
  hashCanonical,
  isPlainObject,
  uniqSorted,
} from './utils.mjs';

export const TASK_SCHEMA_VERSION = 'forgeai.task-envelope.v0.1.1';
export const EVIDENCE_SCHEMA_VERSION = 'forgeai.evidence-bundle.v0.1.1';
export const LEDGER_SCHEMA_VERSION = 'forgeai.ledger-event.v0.1.1';
export const ROLES = Object.freeze(['orchestrator', 'writer', 'reviewer', 'auditor', 'security', 'verifier']);
export const MODES = Object.freeze(['CONSULT', 'AUDIT', 'REVIEW', 'EXECUTE']);
export const RISKS = Object.freeze(['R0', 'R1', 'R2', 'R3']);

const LIMITS = Object.freeze({
  path_rules: 256,
  allowed_commands: 128,
  required_commands: 64,
  network_hosts: 64,
  mcp_tools: 128,
  acceptance_criteria: 128,
  metadata_bytes: 64 * 1024,
});

const TASK_KEYS = [
  'schema_version', 'task_id', 'title', 'objective', 'role', 'mode', 'risk', 'task_kind',
  'base_commit', 'workspace', 'allowed_paths', 'denied_paths', 'allowed_bash_commands',
  'required_test_commands', 'allowed_network_hosts', 'allowed_mcp_tools', 'acceptance_criteria', 'execution',
  'delegation', 'evidence_dir', 'created_at', 'expires_at', 'metadata',
];
const EXECUTION_KEYS = ['harness', 'qualified', 'sandbox_required', 'sandbox_verified'];
const DELEGATION_KEYS = ['agent_depth', 'max_parallel_agents', 'allow_nested_agents'];
const ACCEPTANCE_KEYS = ['id', 'statement', 'verification'];

function validateIdentity(task) {
  for (const key of ['task_id', 'title', 'objective', 'task_kind', 'base_commit', 'workspace', 'evidence_dir']) assertSafeText(task[key], key);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(task.task_id)) throw new Error('task_id format is invalid');
  if (!/^[0-9a-f]{7,64}$/iu.test(task.base_commit)) throw new Error('base_commit must be a Git SHA');
  if (!ROLES.includes(task.role)) throw new Error(`invalid role: ${task.role}`);
  if (!MODES.includes(task.mode)) throw new Error(`invalid mode: ${task.mode}`);
  if (!RISKS.includes(task.risk)) throw new Error(`invalid risk: ${task.risk}`);
}

function validatePathRules(task) {
  assertArrayOfStrings(task.allowed_paths, 'allowed_paths', { min: 1, max: LIMITS.path_rules });
  assertArrayOfStrings(task.denied_paths, 'denied_paths', { max: LIMITS.path_rules });
  for (const pattern of [...task.allowed_paths, ...task.denied_paths]) {
    validateGlobPattern(pattern);
    if (pattern.startsWith('/') || pattern.split('/').includes('..')) throw new Error(`unsafe path pattern: ${pattern}`);
  }
}

function commandIdentities(commands, label) {
  const identities = new Set();
  for (const command of commands) {
    try { identities.add(commandIdentity(command)); }
    catch (error) { throw new Error(`${label}: ${error.message}`); }
  }
  return identities;
}

function validateCommandRules(task) {
  assertArrayOfStrings(task.allowed_bash_commands, 'allowed_bash_commands', { max: LIMITS.allowed_commands });
  assertArrayOfStrings(task.required_test_commands, 'required_test_commands', { min: 1, max: LIMITS.required_commands });
  const allowed = commandIdentities(task.allowed_bash_commands, 'allowed_bash_commands');
  for (const command of task.required_test_commands) {
    let identity;
    try { identity = commandIdentity(command); }
    catch (error) { throw new Error(`required_test_commands: ${error.message}`); }
    if (!allowed.has(identity)) throw new Error(`required test command is not allowed: ${command}`);
  }
}

function validateNetworkRules(task) {
  assertArrayOfStrings(task.allowed_network_hosts, 'allowed_network_hosts', { max: LIMITS.network_hosts });
  for (const host of task.allowed_network_hosts) if (!/^(?:\*\.)?[a-z0-9.-]+$/iu.test(host) || host.includes('..')) throw new Error(`invalid network host rule: ${host}`);
}

function validateMcpRules(task) {
  assertArrayOfStrings(task.allowed_mcp_tools, 'allowed_mcp_tools', { max: LIMITS.mcp_tools });
  for (const tool of task.allowed_mcp_tools) if (!/^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/u.test(tool)) throw new Error(`invalid MCP tool name: ${tool}`);
}

function validateAcceptance(task) {
  if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) throw new TypeError('acceptance_criteria must be a non-empty array');
  if (task.acceptance_criteria.length > LIMITS.acceptance_criteria) throw new Error(`acceptance_criteria must contain at most ${LIMITS.acceptance_criteria} items`);
  const ids = new Set();
  for (const criterion of task.acceptance_criteria) {
    if (!isPlainObject(criterion)) throw new TypeError('acceptance criterion must be an object');
    assertOnlyKeys(criterion, ACCEPTANCE_KEYS, 'acceptance criterion');
    for (const key of ACCEPTANCE_KEYS) assertSafeText(criterion[key], `acceptance.${key}`);
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/u.test(criterion.id)) throw new Error(`invalid acceptance id: ${criterion.id}`);
    if (ids.has(criterion.id)) throw new Error(`duplicate acceptance id: ${criterion.id}`);
    ids.add(criterion.id);
  }
}

function validateMetadata(task) {
  if (!isPlainObject(task.metadata)) throw new TypeError('metadata must be a plain object');
  const bytes = Buffer.byteLength(canonicalize(task.metadata), 'utf8');
  if (bytes > LIMITS.metadata_bytes) throw new Error(`metadata must be at most ${LIMITS.metadata_bytes} bytes`);
  if (task.mode === 'EXECUTE') {
    assertSafeText(task.metadata.writer_model, 'metadata.writer_model');
    assertSafeText(task.metadata.writer_session_id, 'metadata.writer_session_id');
  }
}

function validateExecution(task) {
  if (!isPlainObject(task.execution)) throw new TypeError('execution must be an object');
  assertOnlyKeys(task.execution, EXECUTION_KEYS, 'execution');
  assertSafeText(task.execution.harness, 'execution.harness');
  for (const key of ['qualified', 'sandbox_required', 'sandbox_verified']) if (typeof task.execution[key] !== 'boolean') throw new TypeError(`execution.${key} must be boolean`);
  if (task.mode === 'EXECUTE') {
    if (task.role !== 'writer') throw new Error('EXECUTE mode is restricted to writer role');
    if (!task.execution.qualified) throw new Error('EXECUTE requires a qualified harness');
    if (!task.execution.sandbox_required || !task.execution.sandbox_verified) throw new Error('EXECUTE requires a verified sandbox');
  } else if (task.role === 'writer') throw new Error('writer role requires EXECUTE mode');
}

function validateDelegation(task) {
  if (!isPlainObject(task.delegation)) throw new TypeError('delegation must be an object');
  assertOnlyKeys(task.delegation, DELEGATION_KEYS, 'delegation');
  if (!Number.isInteger(task.delegation.agent_depth) || task.delegation.agent_depth < 0 || task.delegation.agent_depth > 1) throw new Error('agent_depth must be 0 or 1');
  if (!Number.isInteger(task.delegation.max_parallel_agents) || task.delegation.max_parallel_agents < 1 || task.delegation.max_parallel_agents > 4) throw new Error('max_parallel_agents must be between 1 and 4');
  if (task.delegation.allow_nested_agents !== false) throw new Error('nested agents are forbidden in Foundation 0.1.1');
}

function validateTimelineAndLocations(task) {
  assertIsoDate(task.created_at, 'created_at');
  assertIsoDate(task.expires_at, 'expires_at');
  if (Date.parse(task.expires_at) <= Date.parse(task.created_at)) throw new Error('expires_at must be later than created_at');
  if (Date.now() > Date.parse(task.expires_at)) throw new Error('task envelope is expired');
  if (!isAbsolute(task.workspace) || !isAbsolute(task.evidence_dir)) throw new Error('workspace and evidence_dir must be absolute paths');
  const workspace = resolve(task.workspace);
  const evidence = resolve(task.evidence_dir);
  const rel = relative(workspace, evidence);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('evidence_dir must be inside workspace');
}

export function validateTaskEnvelope(task) {
  if (!isPlainObject(task)) throw new TypeError('task envelope must be a plain object');
  assertOnlyKeys(task, TASK_KEYS, 'task envelope');
  if (task.schema_version !== TASK_SCHEMA_VERSION) throw new Error(`unsupported task schema: ${task.schema_version}`);
  validateIdentity(task);
  validatePathRules(task);
  validateCommandRules(task);
  validateNetworkRules(task);
  validateMcpRules(task);
  validateAcceptance(task);
  validateMetadata(task);
  validateExecution(task);
  validateDelegation(task);
  validateTimelineAndLocations(task);
  return task;
}

function canonicalCommands(commands) { return uniqSorted(commands.map(canonicalCommand)); }

export function normalizedTaskEnvelope(task) {
  validateTaskEnvelope(task);
  return {
    ...task,
    workspace: resolve(task.workspace), evidence_dir: resolve(task.evidence_dir),
    allowed_paths: uniqSorted(task.allowed_paths), denied_paths: uniqSorted(task.denied_paths),
    allowed_bash_commands: canonicalCommands(task.allowed_bash_commands), required_test_commands: canonicalCommands(task.required_test_commands),
    allowed_network_hosts: uniqSorted(task.allowed_network_hosts.map((host) => host.toLowerCase())),
    allowed_mcp_tools: uniqSorted(task.allowed_mcp_tools),
    acceptance_criteria: [...task.acceptance_criteria].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function taskEnvelopeHash(task) { return hashCanonical(normalizedTaskEnvelope(task)); }
export const CONTRACT_LIMITS = LIMITS;
