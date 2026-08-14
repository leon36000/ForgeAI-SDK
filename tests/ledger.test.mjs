import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendLedgerEvent, initializeLedger, verifyLedger } from '../src/ledger.mjs';
import { tempWorkspace } from './helpers.mjs';

async function ledger() { const root = join(await tempWorkspace(), 'ledger'); await initializeLedger(root); return root; }
const event = (n = 1) => ({ type: 'TEST', actor: 'test', task_id: 'task-001', timestamp: `2026-08-13T00:00:0${n}.000Z`, payload: { n } });

test('initializes empty ledger', async () => {
  const root = await ledger(); const result = await verifyLedger(root);
  assert.equal(result.count, 0); assert.equal(result.last_hash, '0'.repeat(64));
});
test('appends and verifies one event', async () => {
  const root = await ledger(); const record = await appendLedgerEvent(root, event());
  assert.equal(record.sequence, 1); assert.equal((await verifyLedger(root)).count, 1);
});
test('chains multiple events', async () => {
  const root = await ledger(); const first = await appendLedgerEvent(root, event(1)); const second = await appendLedgerEvent(root, event(2));
  assert.equal(second.previous_hash, first.hash); assert.equal((await verifyLedger(root)).last_hash, second.hash);
});
test('detects payload tampering', async () => {
  const root = await ledger(); await appendLedgerEvent(root, event()); const path = join(root, 'events', '000000000001.json');
  const record = JSON.parse(await readFile(path, 'utf8')); record.payload.n = 9; await writeFile(path, JSON.stringify(record));
  await assert.rejects(() => verifyLedger(root), /hash mismatch/u);
});
test('detects previous hash tampering', async () => {
  const root = await ledger(); await appendLedgerEvent(root, event(1)); await appendLedgerEvent(root, event(2)); const path = join(root, 'events', '000000000002.json');
  const record = JSON.parse(await readFile(path, 'utf8')); record.previous_hash = 'f'.repeat(64); await writeFile(path, JSON.stringify(record));
  await assert.rejects(() => verifyLedger(root), /previous hash mismatch/u);
});
test('detects deletion of last event', async () => {
  const root = await ledger(); await appendLedgerEvent(root, event()); await rm(join(root, 'events', '000000000001.json'));
  await assert.rejects(() => verifyLedger(root), /count mismatch/u);
});
test('detects forged head count', async () => {
  const root = await ledger(); await appendLedgerEvent(root, event()); const path = join(root, 'head.json'); const head = JSON.parse(await readFile(path,'utf8')); head.count=0; await writeFile(path,JSON.stringify(head));
  await assert.rejects(() => verifyLedger(root), /count mismatch/u);
});
test('detects forged head hash', async () => {
  const root = await ledger(); await appendLedgerEvent(root, event()); const path = join(root, 'head.json'); const head = JSON.parse(await readFile(path,'utf8')); head.last_hash='e'.repeat(64); await writeFile(path,JSON.stringify(head));
  await assert.rejects(() => verifyLedger(root), /head hash mismatch/u);
});
test('rejects incomplete event', async () => {
  const root = await ledger(); await assert.rejects(() => appendLedgerEvent(root, { payload: {} }), /required/u);
});
test('serial concurrent appends result in one lock failure rather than corruption', async () => {
  const root = await ledger();
  const results = await Promise.allSettled([appendLedgerEvent(root, event(1)), appendLedgerEvent(root, event(2))]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal((await verifyLedger(root)).count, 1);
});

test('rejects symlinked head',async()=>{const root=await ledger();const outside=join(await tempWorkspace(),'outside.json');await writeFile(outside,JSON.stringify({schema_version:'forgeai.ledger-head.v0.1.1',count:0,last_hash:'0'.repeat(64)}));await rm(join(root,'head.json'));await symlink(outside,join(root,'head.json'));await assert.rejects(()=>verifyLedger(root),/symbolic link/u);});
test('rejects symlinked event',async()=>{const root=await ledger();await appendLedgerEvent(root,event());const path=join(root,'events','000000000001.json');const outside=join(await tempWorkspace(),'outside.json');await writeFile(outside,await readFile(path));await rm(path);await symlink(outside,path);await assert.rejects(()=>verifyLedger(root),/unexpected ledger event entry|symbolic link/u);});
test('rejects unexpected event directory entries',async()=>{const root=await ledger();await writeFile(join(root,'events','junk.tmp'),'x');await assert.rejects(()=>verifyLedger(root),/unexpected ledger event entry/u);});
