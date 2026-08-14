import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ROUTER_LEDGER_SCHEMA_VERSION, LITELLM_ROUTER_LIMITS } from './constants.mjs';
import { canonicalJson } from './contracts.mjs';

const ZERO_HASH = '0'.repeat(64);
const queues = new Map();

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function sanitize(value) {
  const allowed = ['request_id', 'request_hash', 'mode', 'capability', 'route_id', 'model', 'attempt', 'status', 'error_code', 'input_tokens', 'output_tokens', 'total_tokens', 'cost_usd', 'started_at', 'completed_at', 'qualification_evidence_sha256', 'prompt_sha256'];
  const out = {};
  for (const key of allowed) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

async function assertNoSymlink(path) {
  const absolute = resolve(path);
  const parts = absolute.split('/').filter(Boolean);
  let cursor = '/';
  for (const part of parts.slice(0, -1)) {
    cursor = resolve(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`ledger parent is a symlink: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('ledger path must not be a symlink');
    if (!info.isFile()) throw new Error('ledger path must be a regular file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return absolute;
}

async function previousHash(path) {
  try {
    const bytes = await readFile(path, 'utf8');
    const lines = bytes.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return ZERO_HASH;
    const last = JSON.parse(lines.at(-1));
    return typeof last.event_hash === 'string' ? last.event_hash : ZERO_HASH;
  } catch (error) {
    if (error.code === 'ENOENT') return ZERO_HASH;
    throw error;
  }
}

async function append(path, event) {
  const absolute = await assertNoSymlink(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  await assertNoSymlink(absolute);
  try {
    const info = await stat(absolute);
    if (info.size > LITELLM_ROUTER_LIMITS.max_ledger_bytes) throw new Error('router ledger exceeds the configured size limit');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const prevHash = await previousHash(absolute);
  const payload = { schema_version: ROUTER_LEDGER_SCHEMA_VERSION, ...sanitize(event), prev_hash: prevHash };
  payload.event_hash = hash(canonicalJson(payload));
  const flags = fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(absolute, flags, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze(payload);
}

export async function appendRouterLedger(path, event) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const key = resolve(path);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => append(key, event));
  const queued = current.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
  queues.set(key, queued);
  return current;
}

export async function verifyRouterLedger(path) {
  const absolute = await assertNoSymlink(path);
  const bytes = await readFile(absolute, 'utf8');
  const lines = bytes.trim().split('\n').filter(Boolean);
  let prev = ZERO_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index]);
    if (event.prev_hash !== prev) return Object.freeze({ valid: false, index, code: 'PREV_HASH_MISMATCH' });
    const claimed = event.event_hash;
    const copy = { ...event };
    delete copy.event_hash;
    const actual = hash(canonicalJson(copy));
    if (claimed !== actual) return Object.freeze({ valid: false, index, code: 'EVENT_HASH_MISMATCH' });
    prev = claimed;
  }
  return Object.freeze({ valid: true, count: lines.length, last_hash: prev });
}
