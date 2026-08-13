import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LEDGER_SCHEMA_VERSION } from './contracts.mjs';
import { atomicWriteJson, canonicalize, hashCanonical, isPlainObject, readJson } from './utils.mjs';

const GENESIS = '0'.repeat(64);
const EVENT_RE = /^(\d{12})\.json$/u;

export async function initializeLedger(root) {
  await mkdir(join(root, 'events'), { recursive: true });
  const headPath = join(root, 'head.json');
  try {
    await stat(headPath);
  } catch {
    await atomicWriteJson(headPath, { schema_version: 'forgeai.ledger-head.v0.1.1', count: 0, last_hash: GENESIS });
  }
  return verifyLedger(root);
}

function eventHash(body) {
  return hashCanonical({ ...body, hash: undefined });
}

export async function appendLedgerEvent(root, event) {
  if (!isPlainObject(event)) throw new TypeError('ledger event must be an object');
  await initializeLedger(root);
  const lockPath = join(root, '.append.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('ledger append is already in progress');
    throw error;
  }
  try {
    const head = await readJson(join(root, 'head.json'));
    const sequence = head.count + 1;
    const body = {
      schema_version: LEDGER_SCHEMA_VERSION,
      sequence,
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      actor: event.actor,
      task_id: event.task_id,
      payload: event.payload ?? {},
      previous_hash: head.last_hash,
    };
    for (const key of ['type', 'actor', 'task_id']) {
      if (typeof body[key] !== 'string' || body[key].length === 0) throw new Error(`ledger ${key} is required`);
    }
    const hash = hashCanonical(body);
    const record = { ...body, hash };
    const file = join(root, 'events', `${String(sequence).padStart(12, '0')}.json`);
    const temp = `${file}.tmp-${process.pid}`;
    await open(temp, 'wx', 0o600).then(async (handle) => {
      await handle.writeFile(`${canonicalize(record)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
    });
    await rename(temp, file);
    await atomicWriteJson(join(root, 'head.json'), {
      schema_version: 'forgeai.ledger-head.v0.1.1',
      count: sequence,
      last_hash: hash,
    });
    return record;
  } finally {
    await lock?.close().catch(() => {});
    await rm(lockPath, { force: true });
  }
}

export async function verifyLedger(root) {
  const head = await readJson(join(root, 'head.json'));
  if (head.schema_version !== 'forgeai.ledger-head.v0.1.1') throw new Error('unsupported ledger head schema');
  if (!Number.isInteger(head.count) || head.count < 0 || !/^[0-9a-f]{64}$/u.test(head.last_hash)) {
    throw new Error('invalid ledger head');
  }
  const names = (await readdir(join(root, 'events'))).filter((name) => EVENT_RE.test(name)).sort();
  if (names.length !== head.count) throw new Error(`ledger count mismatch: head=${head.count}, files=${names.length}`);
  let previous = GENESIS;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const expectedSequence = index + 1;
    if (Number(EVENT_RE.exec(name)[1]) !== expectedSequence) throw new Error(`ledger sequence gap at ${name}`);
    const record = JSON.parse(await readFile(join(root, 'events', name), 'utf8'));
    if (record.sequence !== expectedSequence) throw new Error(`ledger embedded sequence mismatch at ${name}`);
    if (record.previous_hash !== previous) throw new Error(`ledger previous hash mismatch at ${name}`);
    const { hash, ...body } = record;
    const expected = hashCanonical(body);
    if (hash !== expected) throw new Error(`ledger hash mismatch at ${name}`);
    previous = hash;
  }
  if (previous !== head.last_hash) throw new Error('ledger head hash mismatch');
  return Object.freeze({ valid: true, count: head.count, last_hash: head.last_hash });
}

export const LEDGER_GENESIS = GENESIS;
