import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { checkToolUse } from '../policy.mjs';
import { isPlainObject } from '../utils.mjs';
import {
  CONTROL_PLANE_DENIED_TOOLS,
  REVIEWER_TOOLS,
  SUPPORTED_CLAUDE_AGENT_SDK,
  WRITER_TOOLS,
} from './constants.mjs';
import {
  REVIEWER_OUTPUT_SCHEMA,
  WRITER_OUTPUT_SCHEMA,
  normalizeControlPlanePolicy,
} from './contracts.mjs';

const require = createRequire(import.meta.url);
const MAX_MESSAGES = 10_000;
const MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const RUNTIME_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
  'CLOUD_ML_REGION',
]);
const PROVIDER_ENV_PREFIXES = Object.freeze(['ANTHROPIC_', 'CLAUDE_CODE_', 'AWS_', 'GOOGLE_', 'GCLOUD_', 'AZURE_']);

async function defaultReadPackageMetadata(entry) {
  let cursor = dirname(entry);
  const root = parse(cursor).root;
  for (let depth = 0; depth < 16; depth += 1) {
    try {
      const metadata = JSON.parse(await readFile(join(cursor, 'package.json'), 'utf8'));
      if (metadata?.name === SUPPORTED_CLAUDE_AGENT_SDK.package) return metadata;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cursor === root) break;
    cursor = dirname(cursor);
  }
  throw new Error(`package metadata not found for ${SUPPORTED_CLAUDE_AGENT_SDK.package}`);
}

export async function loadClaudeAgentSdk({
  importer = (specifier) => import(specifier),
  resolveEntry = () => require.resolve(SUPPORTED_CLAUDE_AGENT_SDK.package),
  readPackageMetadata = defaultReadPackageMetadata,
} = {}) {
  let module;
  let entry;
  let metadata;
  try {
    entry = resolveEntry();
    [module, metadata] = await Promise.all([
      importer(SUPPORTED_CLAUDE_AGENT_SDK.package),
      readPackageMetadata(entry),
    ]);
  } catch (error) {
    throw new Error(`Claude Agent SDK unavailable: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(metadata) || metadata.name !== SUPPORTED_CLAUDE_AGENT_SDK.package) throw new Error('Claude Agent SDK package identity mismatch');
  if (metadata.version !== SUPPORTED_CLAUDE_AGENT_SDK.version) {
    throw new Error(`Claude Agent SDK version mismatch: expected ${SUPPORTED_CLAUDE_AGENT_SDK.version}, got ${metadata.version}`);
  }
  if (typeof module?.query !== 'function') throw new Error('Claude Agent SDK does not export query()');
  return Object.freeze({
    package: metadata.name,
    version: metadata.version,
    entry,
    query: module.query,
  });
}

function dedupe(values) {
  return [...new Set(values)];
}

export function sanitizeControlPlaneEnvironment(source = process.env) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('control-plane environment source must be an object');
  const sanitized = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    if (RUNTIME_ENV_KEYS.has(key) || PROVIDER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) sanitized[key] = value;
  }
  return Object.freeze(sanitized);
}

function controlledEnvironment(stage, paths) {
  return {
    ...sanitizeControlPlaneEnvironment(paths.environment ?? process.env),
    FORGEAI_TASK_ENVELOPE: paths.taskEnvelopePath,
    FORGEAI_LEDGER_DIR: paths.ledgerDir,
    FORGEAI_PROOF_RESULT: paths.proofPath,
    FORGEAI_CONTROL_PLANE_STAGE: stage,
  };
}

function createCanUseTool(task, onToolDecision) {
  return async (toolName, input = {}, context = {}) => {
    try {
      const decision = checkToolUse(task, toolName, input);
      await onToolDecision?.(Object.freeze({
        tool_name: toolName,
        input,
        allowed: decision.allowed,
        code: decision.code,
        reason: decision.reason,
        context: {
          tool_use_id: context?.toolUseID ?? context?.tool_use_id ?? null,
          agent_id: context?.agentID ?? context?.agent_id ?? null,
        },
      }));
      if (decision.allowed) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: decision.reason, interrupt: false };
    } catch (error) {
      await onToolDecision?.(Object.freeze({
        tool_name: typeof toolName === 'string' ? toolName : null,
        input,
        allowed: false,
        code: 'POLICY_ERROR',
        reason: error.message,
        context: {},
      })).catch(() => {});
      return { behavior: 'deny', message: `Foundation policy failed closed: ${error.message}`, interrupt: true };
    }
  };
}

function createSandboxOptions() {
  return {
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
  };
}

function commonOptions(task, rolePolicy, paths, stage, outputSchema, allowedTools, disallowedTools, onToolDecision) {
  return {
    cwd: task.workspace,
    model: rolePolicy.model,
    allowedTools: [...allowedTools],
    tools: [...allowedTools],
    disallowedTools: dedupe(disallowedTools),
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    maxTurns: rolePolicy.max_turns,
    maxBudgetUsd: rolePolicy.max_budget_usd,
    outputFormat: { type: 'json_schema', schema: outputSchema },
    persistSession: true,
    sandbox: createSandboxOptions(),
    env: controlledEnvironment(stage, paths),
    canUseTool: createCanUseTool(task, onToolDecision),
  };
}

export function buildWriterOptions(task, policyValue, paths) {
  const policy = normalizeControlPlanePolicy(policyValue);
  return commonOptions(
    task,
    policy.writer,
    paths,
    'writer',
    WRITER_OUTPUT_SCHEMA,
    WRITER_TOOLS,
    CONTROL_PLANE_DENIED_TOOLS,
    paths.onToolDecision,
  );
}

export function buildReviewerOptions(task, policyValue, paths) {
  const policy = normalizeControlPlanePolicy(policyValue);
  return commonOptions(
    task,
    policy.reviewer,
    paths,
    'reviewer',
    REVIEWER_OUTPUT_SCHEMA,
    REVIEWER_TOOLS,
    [...CONTROL_PLANE_DENIED_TOOLS, 'Edit', 'Write', 'Bash'],
    paths.onToolDecision,
  );
}

function messageType(message) {
  const type = typeof message?.type === 'string' ? message.type : 'unknown';
  const subtype = typeof message?.subtype === 'string' ? message.subtype : null;
  return subtype ? `${type}:${subtype}` : type;
}

export async function invokeStructuredAgent({ query, prompt, options, validate }) {
  if (typeof query !== 'function') throw new TypeError('SDK query must be a function');
  if (typeof prompt !== 'string' || prompt.length === 0 || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('agent prompt must be a non-empty bounded string');
  if (!isPlainObject(options)) throw new TypeError('agent options must be a plain object');
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1) throw new Error('agent maxTurns must be a positive integer');
  if (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0) throw new Error('agent maxBudgetUsd must be greater than zero');
  if (typeof validate !== 'function') throw new TypeError('structured-output validator must be a function');

  let iterable;
  try {
    iterable = query({ prompt, options });
  } catch (error) {
    throw new Error(`Claude Agent SDK query failed to start: ${error.message}`, { cause: error });
  }
  if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') throw new Error('Claude Agent SDK query did not return an async iterable');

  const messageTypes = [];
  let terminal = null;
  let count = 0;
  try {
    for await (const message of iterable) {
      count += 1;
      if (count > MAX_MESSAGES) throw new Error(`Claude Agent SDK emitted more than ${MAX_MESSAGES} messages`);
      messageTypes.push(messageType(message));
      if (message?.type === 'result') {
        if (terminal) throw new Error('Claude Agent SDK emitted multiple terminal results');
        terminal = message;
      }
    }
  } catch (error) {
    throw new Error(`Claude Agent SDK query failed: ${error.message}`, { cause: error });
  }

  if (!terminal) throw new Error('Claude Agent SDK terminal result is missing');
  if (terminal.subtype !== 'success' || terminal.is_error === true) throw new Error(`Claude Agent SDK terminal subtype is ${terminal.subtype ?? 'unknown'}`);
  if (typeof terminal.session_id !== 'string' || terminal.session_id.length === 0) throw new Error('Claude Agent SDK terminal result is missing session_id');
  if (!Number.isFinite(terminal.total_cost_usd) || terminal.total_cost_usd < 0) throw new Error('Claude Agent SDK terminal result has invalid total_cost_usd');
  if (terminal.total_cost_usd > options.maxBudgetUsd) throw new Error(`Claude Agent SDK budget exceeded: ${terminal.total_cost_usd} > ${options.maxBudgetUsd}`);
  if (!Number.isInteger(terminal.num_turns) || terminal.num_turns < 0) throw new Error('Claude Agent SDK terminal result has invalid num_turns');
  if (terminal.num_turns > options.maxTurns) throw new Error(`Claude Agent SDK turn limit exceeded: ${terminal.num_turns} > ${options.maxTurns}`);

  let structuredOutput;
  try {
    structuredOutput = validate(terminal.structured_output);
  } catch (error) {
    throw new Error(`Claude Agent SDK structured output is invalid: ${error.message}`, { cause: error });
  }

  return Object.freeze({
    session_id: terminal.session_id,
    subtype: terminal.subtype,
    structured_output: structuredOutput,
    total_cost_usd: terminal.total_cost_usd,
    num_turns: terminal.num_turns,
    duration_ms: Number.isFinite(terminal.duration_ms) && terminal.duration_ms >= 0 ? terminal.duration_ms : null,
    model_usage: isPlainObject(terminal.modelUsage) ? structuredClone(terminal.modelUsage) : {},
    message_types: Object.freeze(messageTypes),
  });
}
