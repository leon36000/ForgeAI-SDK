import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
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

function noFollowFlag() {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW is required for the router ledger');
  return fsConstants.O_NOFOLLOW;
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

async function readSnapshot(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > LITELLM_ROUTER_LIMITS.max_ledger_bytes) throw new Error('router ledger exceeds the configured size limit');
  if (size === 0) return '';
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error('router ledger changed while being read');
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (!after.isFile() || after.size !== size) throw new Error('router ledger changed while being read');
  return buffer.toString('utf8');
}

function previousHash(bytes) {
  const lines = bytes.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return ZERO_HASH;
  const last = JSON.parse(lines.at(-1));
  return typeof last.event_hash === 'string' ? last.event_hash : ZERO_HASH;
}

async function append(path, event) {
  const absolute = await assertNoSymlink(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  await assertNoSymlink(absolute);
  const flags = fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_CREAT | noFollowFlag();
  const handle = await open(absolute, flags, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('ledger path must be a regular file');
    const bytes = await readSnapshot(handle, info.size);
    const payload = { schema_version: ROUTER_LEDGER_SCHEMA_VERSION, ...sanitize(event), prev_hash: previousHash(bytes) };
    payload.event_hash = hash(canonicalJson(payload));
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
    return Object.freeze(payload);
  } finally {
    await handle.close();
  }
}

export async function appendRouterLedger(path, event) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const key = resolve(path);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(() => append(key, event));
  let tail;
  tail = current.catch(() => {}).finally(() => { if (queues.get(key) === tail) queues.delete(key); });
  queues.set(key, tail);
  return current;
}

export async function verifyRouterLedger(path) {
  const absolute = await assertNoSymlink(path);
  const handle = await open(absolute, fsConstants.O_RDONLY | noFollowFlag());
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('ledger path must be a regular file');
    bytes = await readSnapshot(handle, info.size);
  } finally {
    await handle.close();
  }
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
