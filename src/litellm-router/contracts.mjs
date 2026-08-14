import { createHash } from 'node:crypto';
import {
  ADVISORY_MODES,
  ADVISORY_REQUEST_SCHEMA_VERSION,
  ADVISORY_RESULT_SCHEMA_VERSION,
  ADVISORY_STATUSES,
  LITELLM_ROUTER_LIMITS,
  LITELLM_ROUTER_POLICY_SCHEMA_VERSION,
  QUALIFICATION_STATUSES,
  QUALIFIED_HARNESS,
} from './constants.mjs';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CONTEXT_KINDS = new Set(['text', 'diff', 'code', 'test', 'log', 'requirement', 'evidence']);
const SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

function fail(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = 'CONTRACT_INVALID';
  throw error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function object(value, path) {
  if (!isPlainObject(value)) fail(path, 'must be a plain object');
  return value;
}

function exactKeys(value, path, required, optional = []) {
  object(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) fail(`${path}.${key}`, 'is required');
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'is not allowed');
}

function string(value, path, { min = 1, max = 1024, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(path, `must be a string of length ${min}..${max}`);
  if (/\u0000|\r|\n/u.test(value) && max <= 1024) fail(path, 'must not contain line or NUL control characters');
  if (pattern && !pattern.test(value)) fail(path, 'has an invalid format');
  return value;
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer in ${min}..${max}`);
  return value;
}

function number(value, path, { min = 0, max = Number.MAX_VALUE } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `must be a finite number in ${min}..${max}`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be boolean');
  return value;
}

function uniqueStrings(value, path, { min = 0, max = 64, allowed } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must be an array of length ${min}..${max}`);
  const out = value.map((item, index) => string(item, `${path}[${index}]`, { max: 128, pattern: IDENTIFIER }));
  if (new Set(out).size !== out.length) fail(path, 'must not contain duplicates');
  if (allowed) for (const item of out) if (!allowed.includes(item)) fail(path, `contains unsupported value ${item}`);
  return out;
}

function isoDate(value, path) {
  string(value, path, { min: 20, max: 24, pattern: ISO_DATE });
  if (!Number.isFinite(Date.parse(value))) fail(path, 'must be a valid ISO timestamp');
  return value;
}

function nullable(value, parser) {
  return value === null ? null : parser(value);
}

function scalarMetadata(value, path) {
  object(value, path);
  const keys = Object.keys(value);
  if (keys.length > LITELLM_ROUTER_LIMITS.max_metadata_keys) fail(path, 'contains too many keys');
  const out = {};
  for (const key of keys) {
    string(key, `${path} key`, { max: 128, pattern: IDENTIFIER });
    const item = value[key];
    if (typeof item === 'string') out[key] = string(item, `${path}.${key}`, { min: 0, max: 1024 });
    else if (typeof item === 'number') out[key] = number(item, `${path}.${key}`, { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
    else if (typeof item === 'boolean' || item === null) out[key] = item;
    else fail(`${path}.${key}`, 'must be a string, finite number, boolean, or null');
  }
  return out;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function parseLimits(value, path) {
  exactKeys(value, path, ['max_output_tokens', 'max_total_tokens', 'max_cost_usd', 'max_timeout_ms']);
  return {
    max_output_tokens: integer(value.max_output_tokens, `${path}.max_output_tokens`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_output_tokens }),
    max_total_tokens: integer(value.max_total_tokens, `${path}.max_total_tokens`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_total_tokens }),
    max_cost_usd: number(value.max_cost_usd, `${path}.max_cost_usd`, { min: 0.000001, max: LITELLM_ROUTER_LIMITS.max_cost_usd }),
    max_timeout_ms: integer(value.max_timeout_ms, `${path}.max_timeout_ms`, { min: 100, max: LITELLM_ROUTER_LIMITS.max_timeout_ms }),
  };
}

function parsePricing(value, path) {
  if (value === null) return null;
  exactKeys(value, path, ['input_per_million_usd', 'output_per_million_usd']);
  return {
    input_per_million_usd: number(value.input_per_million_usd, `${path}.input_per_million_usd`, { max: 100_000 }),
    output_per_million_usd: number(value.output_per_million_usd, `${path}.output_per_million_usd`, { max: 100_000 }),
  };
}

function parseQualification(value, path) {
  exactKeys(value, path, ['status', 'harness', 'benchmark_id', 'qualified_at', 'expires_at', 'evidence_sha256']);
  if (value.status !== 'QUALIFIED') fail(`${path}.status`, 'must equal QUALIFIED');
  if (value.harness !== QUALIFIED_HARNESS) fail(`${path}.harness`, `must equal ${QUALIFIED_HARNESS}`);
  return {
    status: 'QUALIFIED',
    harness: QUALIFIED_HARNESS,
    benchmark_id: string(value.benchmark_id, `${path}.benchmark_id`, { max: 128, pattern: IDENTIFIER }),
    qualified_at: isoDate(value.qualified_at, `${path}.qualified_at`),
    expires_at: isoDate(value.expires_at, `${path}.expires_at`),
    evidence_sha256: string(value.evidence_sha256, `${path}.evidence_sha256`, { min: 64, max: 64, pattern: SHA256 }),
  };
}

function parseRoute(value, index) {
  const path = `policy.routes[${index}]`;
  exactKeys(value, path, ['route_id', 'model', 'status', 'modes', 'capabilities', 'qualification', 'limits', 'pricing', 'retry', 'circuit_breaker']);
  const status = string(value.status, `${path}.status`, { max: 32 });
  if (!QUALIFICATION_STATUSES.includes(status)) fail(`${path}.status`, 'is unsupported');
  const qualification = nullable(value.qualification, (item) => parseQualification(item, `${path}.qualification`));
  if (status === 'QUALIFIED' && qualification === null) fail(`${path}.qualification`, 'is required for QUALIFIED routes');
  if (status !== 'QUALIFIED' && qualification !== null) fail(`${path}.qualification`, 'must be null unless the route is QUALIFIED');
  exactKeys(value.retry, `${path}.retry`, ['max_attempts', 'backoff_ms']);
  exactKeys(value.circuit_breaker, `${path}.circuit_breaker`, ['failure_threshold', 'cooldown_ms']);
  return {
    route_id: string(value.route_id, `${path}.route_id`, { max: 128, pattern: IDENTIFIER }),
    model: string(value.model, `${path}.model`, { max: 256, pattern: IDENTIFIER }),
    status,
    modes: uniqueStrings(value.modes, `${path}.modes`, { min: 1, max: ADVISORY_MODES.length, allowed: ADVISORY_MODES }),
    capabilities: uniqueStrings(value.capabilities, `${path}.capabilities`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_capabilities }),
    qualification,
    limits: parseLimits(value.limits, `${path}.limits`),
    pricing: parsePricing(value.pricing, `${path}.pricing`),
    retry: {
      max_attempts: integer(value.retry.max_attempts, `${path}.retry.max_attempts`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_retries_per_route }),
      backoff_ms: integer(value.retry.backoff_ms, `${path}.retry.backoff_ms`, { min: 0, max: LITELLM_ROUTER_LIMITS.max_retry_backoff_ms }),
    },
    circuit_breaker: {
      failure_threshold: integer(value.circuit_breaker.failure_threshold, `${path}.circuit_breaker.failure_threshold`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_circuit_failure_threshold }),
      cooldown_ms: integer(value.circuit_breaker.cooldown_ms, `${path}.circuit_breaker.cooldown_ms`, { min: 100, max: LITELLM_ROUTER_LIMITS.max_circuit_cooldown_ms }),
    },
  };
}

export function validateRouterPolicy(value) {
  exactKeys(value, 'policy', ['schema_version', 'policy_id', 'endpoint_env', 'api_key_env', 'routes', 'capability_routes']);
  if (value.schema_version !== LITELLM_ROUTER_POLICY_SCHEMA_VERSION) fail('policy.schema_version', 'is unsupported');
  if (!Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > LITELLM_ROUTER_LIMITS.max_routes) fail('policy.routes', 'has an invalid length');
  const routes = value.routes.map(parseRoute);
  const routeIds = routes.map((route) => route.route_id);
  if (new Set(routeIds).size !== routeIds.length) fail('policy.routes', 'route_id values must be unique');
  object(value.capability_routes, 'policy.capability_routes');
  const capabilityKeys = Object.keys(value.capability_routes);
  if (capabilityKeys.length < 1 || capabilityKeys.length > LITELLM_ROUTER_LIMITS.max_capabilities) fail('policy.capability_routes', 'has an invalid number of capabilities');
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const capabilityRoutes = {};
  for (const capability of capabilityKeys) {
    string(capability, 'policy.capability_routes key', { max: 128, pattern: IDENTIFIER });
    const ids = uniqueStrings(value.capability_routes[capability], `policy.capability_routes.${capability}`, { min: 1, max: LITELLM_ROUTER_LIMITS.max_routes_per_capability });
    for (const routeId of ids) {
      const route = routeById.get(routeId);
      if (!route) fail(`policy.capability_routes.${capability}`, `references unknown route ${routeId}`);
      if (!route.capabilities.includes(capability)) fail(`policy.capability_routes.${capability}`, `route ${routeId} does not declare this capability`);
    }
    capabilityRoutes[capability] = ids;
  }
  return deepFreeze({
    schema_version: LITELLM_ROUTER_POLICY_SCHEMA_VERSION,
    policy_id: string(value.policy_id, 'policy.policy_id', { max: 128, pattern: IDENTIFIER }),
    endpoint_env: string(value.endpoint_env, 'policy.endpoint_env', { max: 128, pattern: ENV_NAME }),
    api_key_env: string(value.api_key_env, 'policy.api_key_env', { max: 128, pattern: ENV_NAME }),
    routes,
    capability_routes: capabilityRoutes,
  });
}

function parseContext(value, index) {
  const path = `request.context[${index}]`;
  exactKeys(value, path, ['id', 'kind', 'content'], ['path', 'sha256']);
  const kind = string(value.kind, `${path}.kind`, { max: 32 });
  if (!CONTEXT_KINDS.has(kind)) fail(`${path}.kind`, 'is unsupported');
  const out = {
    id: string(value.id, `${path}.id`, { max: 128, pattern: IDENTIFIER }),
    kind,
    content: string(value.content, `${path}.content`, { min: 0, max: LITELLM_ROUTER_LIMITS.max_context_item_chars }),
  };
  if ('path' in value) out.path = string(value.path, `${path}.path`, { max: 1024 });
  if ('sha256' in value) out.sha256 = string(value.sha256, `${path}.sha256`, { min: 64, max: 64, pattern: SHA256 });
  return out;
}

export function validateAdvisoryRequest(value) {
  exactKeys(value, 'request', ['schema_version', 'request_id', 'mode', 'capability', 'objective', 'context', 'max_output_tokens', 'max_total_tokens', 'max_cost_usd', 'timeout_ms', 'allow_fallback'], ['metadata']);
  if (value.schema_version !== ADVISORY_REQUEST_SCHEMA_VERSION) fail('request.schema_version', 'is unsupported');
  const mode = string(value.mode, 'request.mode', { max: 32 });
  if (!ADVISORY_MODES.includes(mode)) fail('request.mode', 'is unsupported');
  if (!Array.isArray(value.context) || value.context.length > LITELLM_ROUTER_LIMITS.max_context_items) fail('request.context', 'has an invalid length');
  const context = value.context.map(parseContext);
  if (new Set(context.map((item) => item.id)).size !== context.length) fail('request.context', 'id values must be unique');
  const totalContext = context.reduce((sum, item) => sum + item.content.length, 0);
  if (totalContext > LITELLM_ROUTER_LIMITS.max_context_chars) fail('request.context', 'total content exceeds the limit');
  return deepFreeze({
    schema_version: ADVISORY_REQUEST_SCHEMA_VERSION,
    request_id: string(value.request_id, 'request.request_id', { max: 128, pattern: IDENTIFIER }),
    mode,
    capability: string(value.capability, 'request.capability', { max: 128, pattern: IDENTIFIER }),
    objective: string(value.objective, 'request.objective', { max: LITELLM_ROUTER_LIMITS.max_objective_chars }),
    context,
    max_output_tokens: integer(value.max_output_tokens, 'request.max_output_tokens', { min: 1, max: LITELLM_ROUTER_LIMITS.max_output_tokens }),
    max_total_tokens: integer(value.max_total_tokens, 'request.max_total_tokens', { min: 1, max: LITELLM_ROUTER_LIMITS.max_total_tokens }),
    max_cost_usd: number(value.max_cost_usd, 'request.max_cost_usd', { min: 0.000001, max: LITELLM_ROUTER_LIMITS.max_cost_usd }),
    timeout_ms: integer(value.timeout_ms, 'request.timeout_ms', { min: 100, max: LITELLM_ROUTER_LIMITS.max_timeout_ms }),
    allow_fallback: boolean(value.allow_fallback, 'request.allow_fallback'),
    metadata: 'metadata' in value ? scalarMetadata(value.metadata, 'request.metadata') : {},
  });
}

function parseFinding(value, index) {
  const path = `result.findings[${index}]`;
  exactKeys(value, path, ['severity', 'code', 'title', 'evidence', 'recommendation'], ['path', 'line']);
  const severity = string(value.severity, `${path}.severity`, { max: 16 });
  if (!SEVERITIES.has(severity)) fail(`${path}.severity`, 'is unsupported');
  const out = {
    severity,
    code: string(value.code, `${path}.code`, { max: 128, pattern: IDENTIFIER }),
    title: string(value.title, `${path}.title`, { max: 512 }),
    evidence: string(value.evidence, `${path}.evidence`, { max: 4096 }),
    recommendation: string(value.recommendation, `${path}.recommendation`, { max: 4096 }),
  };
  if ('path' in value) out.path = string(value.path, `${path}.path`, { max: 1024 });
  if ('line' in value) out.line = integer(value.line, `${path}.line`, { min: 1, max: 10_000_000 });
  return out;
}

export function validateAdvisoryResult(value) {
  exactKeys(value, 'result', ['schema_version', 'status', 'summary', 'findings', 'recommendations', 'confidence']);
  if (value.schema_version !== ADVISORY_RESULT_SCHEMA_VERSION) fail('result.schema_version', 'is unsupported');
  const status = string(value.status, 'result.status', { max: 32 });
  if (!ADVISORY_STATUSES.includes(status)) fail('result.status', 'is unsupported');
  if (!Array.isArray(value.findings) || value.findings.length > LITELLM_ROUTER_LIMITS.max_findings) fail('result.findings', 'has an invalid length');
  if (!Array.isArray(value.recommendations) || value.recommendations.length > LITELLM_ROUTER_LIMITS.max_recommendations) fail('result.recommendations', 'has an invalid length');
  const findings = value.findings.map(parseFinding);
  const recommendations = value.recommendations.map((item, index) => string(item, `result.recommendations[${index}]`, { max: 4096 }));
  if (status === 'PASS' && findings.some((item) => item.severity === 'high' || item.severity === 'critical')) fail('result.status', 'PASS cannot contain high or critical findings');
  return deepFreeze({
    schema_version: ADVISORY_RESULT_SCHEMA_VERSION,
    status,
    summary: string(value.summary, 'result.summary', { min: 1, max: LITELLM_ROUTER_LIMITS.max_message_chars }),
    findings,
    recommendations,
    confidence: number(value.confidence, 'result.confidence', { min: 0, max: 1 }),
  });
}

export const CONTRACT_PATTERNS = Object.freeze({ IDENTIFIER, ENV_NAME, SHA256, ISO_DATE });
