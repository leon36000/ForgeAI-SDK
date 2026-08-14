import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { matchesAny, toPosixPath } from './glob.mjs';
import { normalizeWhitespace } from './utils.mjs';
import { normalizedTaskEnvelope } from './contracts.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const PROTECTED_PATHS = Object.freeze([
  '.git/**',
  '.forgeai/**',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/agents/**',
  '.claude/hooks/**',
  '.env', '.env.*', '**/.env', '**/.env.*',
  '**/*.pem', '**/*.key', '**/id_rsa', '**/id_rsa.*',
]);
const ALWAYS_DENIED_COMMANDS = [
  /(?:^|\s)sudo(?:\s|$)/u,
  /(?:^|\s)rm\s+-[^\n]*r[^\n]*f[^\n]*\s+(?:\/|~|\$HOME)(?:\s|$)/u,
  /(?:^|\s)git\s+reset\s+--hard(?:\s|$)/u,
  /(?:^|\s)git\s+clean\s+-[^\n]*[xXf][^\n]*(?:\s|$)/u,
  /(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)(?:\s|$)/u,
  /(?:^|\s)(?:mkfs|shutdown|reboot|poweroff)(?:\s|$)/u,
];

function decision(allowed, code, reason, details = {}) {
  return Object.freeze({ allowed, code, reason, details });
}

function isInside(workspace, candidate) {
  const rel = relative(workspace, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function resolvePhysicalCandidate(workspace, candidate) {
  const missing = [];
  let cursor = candidate;
  while (!existsSync(cursor)) {
    missing.unshift(basename(cursor));
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('unable to resolve path');
    cursor = parent;
  }
  const physicalBase = realpathSync(cursor);
  const physical = resolve(physicalBase, ...missing);
  if (!isInside(workspace, physical)) throw new Error('path traverses an escaping symlink');
  return physical;
}

function containsSymlink(workspace, candidate) {
  const rel = relative(workspace, candidate);
  let cursor = workspace;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

export function normalizeRepoPath(workspaceValue, pathValue, { write = false } = {}) {
  const workspace = realpathSync(resolve(workspaceValue));
  if (typeof pathValue !== 'string' || pathValue.length === 0 || /[\u0000\u000a\u000d\u202a-\u202e\u2066-\u2069]/u.test(pathValue)) {
    throw new Error('path is empty or contains forbidden control characters');
  }
  const candidate = resolve(workspace, pathValue);
  if (!isInside(workspace, candidate)) throw new Error('path escapes workspace');
  const physical = resolvePhysicalCandidate(workspace, candidate);
  if (write && containsSymlink(workspace, candidate)) throw new Error('writes through symlinks are forbidden');
  return {
    workspace,
    absolute: candidate,
    physical,
    relative: toPosixPath(relative(workspace, candidate)) || '.',
    physical_relative: toPosixPath(relative(workspace, physical)) || '.',
  };
}

export function checkPath(taskValue, pathValue, { write = false } = {}) {
  const task = normalizedTaskEnvelope(taskValue);
  let normalized;
  try {
    normalized = normalizeRepoPath(task.workspace, pathValue, { write });
  } catch (error) {
    return decision(false, 'PATH_INVALID', error.message);
  }
  const denied = [...PROTECTED_PATHS, ...task.denied_paths];
  if (matchesAny(normalized.relative, denied) || matchesAny(normalized.physical_relative, denied)) {
    return decision(false, 'PATH_DENIED', `path is denied: ${normalized.relative}`);
  }
  if (!matchesAny(normalized.relative, task.allowed_paths) || !matchesAny(normalized.physical_relative, task.allowed_paths)) {
    return decision(false, 'PATH_OUT_OF_SCOPE', `path is outside allowed scope: ${normalized.relative}`);
  }
  if (write && task.role !== 'writer') return decision(false, 'ROLE_READ_ONLY', `${task.role} cannot write`);
  if (write && task.mode !== 'EXECUTE') return decision(false, 'MODE_READ_ONLY', `${task.mode} cannot write`);
  return decision(true, 'ALLOW', 'path allowed', normalized);
}

export function checkCommand(taskValue, commandValue) {
  const task = normalizedTaskEnvelope(taskValue);
  let command;
  try {
    command = normalizeWhitespace(commandValue);
  } catch (error) {
    return decision(false, 'COMMAND_INVALID', error.message);
  }
  if (ALWAYS_DENIED_COMMANDS.some((pattern) => pattern.test(command))) {
    return decision(false, 'COMMAND_DESTRUCTIVE', 'command is unconditionally denied');
  }
  const normalizedAllowed = task.allowed_bash_commands.map(normalizeWhitespace);
  if (!normalizedAllowed.includes(command)) {
    return decision(false, 'COMMAND_NOT_DECLARED', 'command is not in allowed_bash_commands');
  }
  return decision(true, 'ALLOW', 'command allowed', { command });
}

export function checkNetwork(taskValue, urlValue) {
  const task = normalizedTaskEnvelope(taskValue);
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return decision(false, 'URL_INVALID', 'network target is not a valid URL');
  }
  const host = url.hostname.toLowerCase();
  const allowed = task.allowed_network_hosts.some((rule) => {
    const normalized = rule.toLowerCase();
    return normalized.startsWith('*.') ? host.endsWith(normalized.slice(1)) && host !== normalized.slice(2) : host === normalized;
  });
  return allowed ? decision(true, 'ALLOW', 'network host allowed', { host }) : decision(false, 'NETWORK_DENIED', `host is not allowed: ${host}`);
}

export function checkToolUse(taskValue, toolName, input = {}) {
  const task = normalizedTaskEnvelope(taskValue);
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return decision(false, 'TOOL_INVALID', 'tool name must be a non-empty string');
  }
  if (WRITE_TOOLS.has(toolName)) {
    const path = input.file_path ?? input.path ?? input.notebook_path;
    return checkPath(task, path, { write: true });
  }
  if (READ_TOOLS.has(toolName)) {
    const path = input.file_path ?? input.path ?? '.';
    return checkPath(task, path, { write: false });
  }
  if (toolName === 'Bash') return checkCommand(task, input.command);
  if (toolName === 'WebFetch') return checkNetwork(task, input.url);
  if (toolName.startsWith('mcp__')) {
    if (task.mode === 'EXECUTE') return decision(false, 'MCP_EXECUTE_DENIED', 'external MCP calls are advisory only during EXECUTE');
    if (!task.allowed_mcp_tools.includes(toolName)) return decision(false, 'MCP_TOOL_NOT_DECLARED', 'MCP tool is not allowlisted');
    return decision(true, 'ALLOW', 'declared read-only MCP consultation allowed');
  }
  return decision(false, 'TOOL_NOT_DECLARED', `tool is not governed: ${toolName}`);
}

export function isProtectedRepoPath(path) {
  return matchesAny(toPosixPath(path), PROTECTED_PATHS);
}

export const POLICY_CONSTANTS = Object.freeze({ PROTECTED_PATHS, WRITE_TOOLS: [...WRITE_TOOLS], READ_TOOLS: [...READ_TOOLS] });
