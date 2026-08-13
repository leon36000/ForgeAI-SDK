import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FORBIDDEN_CONTROL_RE = /[\u0000\u000a\u000d\u202a-\u202e\u2066-\u2069]/u;

export function assertSafeText(value, label = 'value') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (FORBIDDEN_CONTROL_RE.test(value)) {
    throw new Error(`${label} contains forbidden control characters`);
  }
  return value;
}

function normalizeCanonical(value, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCanonical(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('canonical JSON accepts plain objects only');
    }
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new TypeError(`canonical JSON rejects unsupported value at ${key}`);
      }
      out[key] = normalizeCanonical(item, seen);
    }
    seen.delete(value);
    return out;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalize(value) {
  return JSON.stringify(normalizeCanonical(value, new WeakSet()));
}

export function sha256(value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(payload).digest('hex');
}

export function hashCanonical(value) {
  return sha256(canonicalize(value));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${canonicalize(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export function normalizeWhitespace(value) {
  return assertSafeText(value, 'command').trim().replace(/[\t ]+/gu, ' ');
}

export function uniqSorted(values) {
  return [...new Set(values)].sort();
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} has unexpected keys: ${unexpected.join(', ')}`);
}

export function assertArrayOfStrings(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return value;
}

export function assertIsoDate(value, label) {
  assertSafeText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return value;
}
