import { resolve } from 'node:path';
import { normalizeWhitespace } from './utils.mjs';
import {
  assertArrayOfStrings,
  assertIsoDate,
  assertOnlyKeys,
  assertSafeText,
  hashCanonical,
  isPlainObject,
  uniqSorted,
} from './utils.mjs';

function normalizeCommandForValidation(command) {
  normalizeWhitespace(command);
}

export const TASK_SCHEMA_VERSION = 'forgeai.task-envelope.v0.1.1';
export const EVIDENCE_SCHEMA_VERSION = 'forgeai.evidence-bundle.v0.1.1';
export const LEDGER_SCHEMA_VERSION = 'forgeai.ledger-event.v0.1.1';
export const ROLES = Object.freeze(['orchestrator', 'writer', 'reviewer', 'auditor', 'security', 'verifier']);
export const MODES = Object.freeze(['CONSULT', 'AUDIT', 'REVIEW', 'EXECUTE']);
export const RISKS = Object.freeze(['R0', 'R1', 'R2', 'R3']);

const TASK_KEYS = [
  'schema_version', 'task_id', 'title', 'objective', 'role', 'mode', 'risk', 'task_kind',
  'base_commit', 'workspace', 'allowed_paths', 'denied_paths', 'allowed_bash_commands',
  'required_test_commands', 'allowed_network_hosts', 'allowed_mcp_tools', 'acceptance_criteria', 'execution',
  'delegation', 'evidence_dir', 'created_at', 'expires_at', 'metadata',
];

const EXECUTION_KEYS = ['harness', 'qualified', 'sandbox_required', 'sandbox_verified'];
const DELEGATION_KEYS = ['agent_depth', 'max_parallel_agents', 'allow_nested_agents'];
const ACCEPTANCE_KEYS = ['id', 'statement', 'verification'];

export function validateTaskEnvelope(task) {
  if (!isPlainObject(task)) throw new TypeError('task envelope must be a plain object');
  assertOnlyKeys(task, TASK_KEYS, 'task envelope');
  if (task.schema_version !== TASK_SCHEMA_VERSION) throw new Error(`unsupported task schema: ${task.schema_version}`);
  for (const key of ['task_id', 'title', 'objective', 'task_kind', 'base_commit', 'workspace', 'evidence_dir']) {
    assertSafeText(task[key], key);
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(task.task_id)) throw new Error('task_id format is invalid');
  if (!/^[0-9a-f]{7,64}$/iu.test(task.base_commit)) throw new Error('base_commit must be a Git SHA');
  if (!ROLES.includes(task.role)) throw new Error(`invalid role: ${task.role}`);
  if (!MODES.includes(task.mode)) throw new Error(`invalid mode: ${task.mode}`);
  if (!RISKS.includes(task.risk)) throw new Error(`invalid risk: ${task.risk}`);
  assertArrayOfStrings(task.allowed_paths, 'allowed_paths', { min: 1 });
  assertArrayOfStrings(task.denied_paths, 'denied_paths');
  assertArrayOfStrings(task.allowed_bash_commands, 'allowed_bash_commands');
  assertArrayOfStrings(task.required_test_commands, 'required_test_commands', { min: 1 });
  assertArrayOfStrings(task.allowed_network_hosts, 'allowed_network_hosts');
  assertArrayOfStrings(task.allowed_mcp_tools, 'allowed_mcp_tools');
  for (const pattern of [...task.allowed_paths, ...task.denied_paths]) {
    assertSafeText(pattern, 'path pattern');
    if (pattern.startsWith('/') || pattern.split('/').includes('..')) throw new Error(`unsafe path pattern: ${pattern}`);
  }
  for (const command of task.allowed_bash_commands) normalizeCommandForValidation(command);
  for (const host of task.allowed_network_hosts) {
    if (!/^(?:\*\.)?[a-z0-9.-]+$/iu.test(host) || host.includes('..')) throw new Error(`invalid network host rule: ${host}`);
  }
  for (const tool of task.allowed_mcp_tools) {
    if (!/^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/u.test(tool)) throw new Error(`invalid MCP tool name: ${tool}`);
  }
  for (const command of task.required_test_commands) {
    if (!task.allowed_bash_commands.includes(command)) {
      throw new Error(`required test command is not allowed: ${command}`);
    }
  }
  if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
    throw new TypeError('acceptance_criteria must be a non-empty array');
  }
  const ids = new Set();
  for (const criterion of task.acceptance_criteria) {
    if (!isPlainObject(criterion)) throw new TypeError('acceptance criterion must be an object');
    assertOnlyKeys(criterion, ACCEPTANCE_KEYS, 'acceptance criterion');
    for (const key of ACCEPTANCE_KEYS) assertSafeText(criterion[key], `acceptance.${key}`);
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/u.test(criterion.id)) throw new Error(`invalid acceptance id: ${criterion.id}`);
    if (ids.has(criterion.id)) throw new Error(`duplicate acceptance id: ${criterion.id}`);
    ids.add(criterion.id);
  }
  if (!isPlainObject(task.execution)) throw new TypeError('execution must be an object');
  assertOnlyKeys(task.execution, EXECUTION_KEYS, 'execution');
  assertSafeText(task.execution.harness, 'execution.harness');
  for (const key of ['qualified', 'sandbox_required', 'sandbox_verified']) {
    if (typeof task.execution[key] !== 'boolean') throw new TypeError(`execution.${key} must be boolean`);
  }
  if (task.mode === 'EXECUTE') {
    if (task.role !== 'writer') throw new Error('EXECUTE mode is restricted to writer role');
    if (!task.execution.qualified) throw new Error('EXECUTE requires a qualified harness');
    if (!task.execution.sandbox_required || !task.execution.sandbox_verified) {
      throw new Error('EXECUTE requires a verified sandbox');
    }
  } else if (task.role === 'writer') {
    throw new Error('writer role requires EXECUTE mode');
  }
  if (!isPlainObject(task.delegation)) throw new TypeError('delegation must be an object');
  assertOnlyKeys(task.delegation, DELEGATION_KEYS, 'delegation');
  if (!Number.isInteger(task.delegation.agent_depth) || task.delegation.agent_depth < 0 || task.delegation.agent_depth > 1) {
    throw new Error('agent_depth must be 0 or 1');
  }
  if (!Number.isInteger(task.delegation.max_parallel_agents) || task.delegation.max_parallel_agents < 1 || task.delegation.max_parallel_agents > 4) {
    throw new Error('max_parallel_agents must be between 1 and 4');
  }
  if (task.delegation.allow_nested_agents !== false) throw new Error('nested agents are forbidden in Foundation 0.1.1');
  assertIsoDate(task.created_at, 'created_at');
  assertIsoDate(task.expires_at, 'expires_at');
  if (Date.parse(task.expires_at) <= Date.parse(task.created_at)) throw new Error('expires_at must be later than created_at');
  if (Date.now() > Date.parse(task.expires_at)) throw new Error('task envelope is expired');
  if (!isPlainObject(task.metadata)) throw new TypeError('metadata must be a plain object');
  const workspace = resolve(task.workspace);
  const evidence = resolve(task.evidence_dir);
  if (!(evidence === workspace || evidence.startsWith(`${workspace}/`))) throw new Error('evidence_dir must be inside workspace');
  return task;
}

export function normalizedTaskEnvelope(task) {
  validateTaskEnvelope(task);
  return {
    ...task,
    workspace: resolve(task.workspace),
    evidence_dir: resolve(task.evidence_dir),
    allowed_paths: uniqSorted(task.allowed_paths),
    denied_paths: uniqSorted(task.denied_paths),
    allowed_bash_commands: uniqSorted(task.allowed_bash_commands),
    required_test_commands: uniqSorted(task.required_test_commands),
    allowed_network_hosts: uniqSorted(task.allowed_network_hosts.map((host) => host.toLowerCase())),
    allowed_mcp_tools: uniqSorted(task.allowed_mcp_tools),
    acceptance_criteria: [...task.acceptance_criteria].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function taskEnvelopeHash(task) {
  return hashCanonical(normalizedTaskEnvelope(task));
}
