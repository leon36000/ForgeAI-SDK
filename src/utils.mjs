import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readStableRegularFile } from './safe-file.mjs';

const FORBIDDEN_CONTROL_RE = /[\u0000\u000a\u000d\u202a-\u202e\u2066-\u2069]/u;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export function assertSafeText(value, label = 'value') {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  if (FORBIDDEN_CONTROL_RE.test(value)) throw new Error(`${label} contains forbidden control characters`);
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
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('canonical JSON accepts plain objects only');
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') throw new TypeError(`canonical JSON rejects unsupported value at ${key}`);
      out[key] = normalizeCanonical(item, seen);
    }
    seen.delete(value);
    return out;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalize(value) { return JSON.stringify(normalizeCanonical(value, new WeakSet())); }
export function sha256(value) { return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')).digest('hex'); }
export function hashCanonical(value) { return sha256(canonicalize(value)); }

export async function readJson(path, { maxBytes = MAX_JSON_BYTES } = {}) {
  const { bytes } = await readStableRegularFile(path, { maxBytes });
  return JSON.parse(bytes.toString('utf8'));
}

async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL','ENOTSUP','EISDIR','EPERM'].includes(error.code)) throw error; }
  finally { await handle?.close().catch(() => {}); }
}

export async function atomicWriteFile(path, value, { mode = 0o600 } = {}) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError('atomic file contents must be a string, Buffer, or Uint8Array');
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new Error('atomic file mode must be between 000 and 777');
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(value, typeof value === 'string' ? 'utf8' : undefined);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}
export async function atomicWriteText(path, value, options = {}) { if (typeof value !== 'string') throw new TypeError('atomic text contents must be a string'); await atomicWriteFile(path, value, options); }
export async function atomicWriteJson(path, value, options = {}) { await atomicWriteText(path, `${canonicalize(value)}\n`, options); }
export function normalizeWhitespace(value) { return assertSafeText(value, 'command').trim().replace(/[\t ]+/gu, ' '); }
export function uniqSorted(values) { return [...new Set(values)].sort(); }
export function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
export function assertOnlyKeys(value, allowed, label) { const unexpected = Object.keys(value).filter((key) => !allowed.includes(key)); if (unexpected.length > 0) throw new Error(`${label} has unexpected keys: ${unexpected.join(', ')}`); }
export function assertArrayOfStrings(value, label, { min = 0, max = Infinity } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== 'string' || item.length === 0)) throw new TypeError(`${label} must be an array of non-empty strings`);
  if (value.length > max) throw new Error(`${label} must contain at most ${max} items`);
  return value;
}
export function assertIsoDate(value, label) {
  assertSafeText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  return value;
}
export const UTILITY_LIMITS = Object.freeze({ max_json_bytes: MAX_JSON_BYTES });
