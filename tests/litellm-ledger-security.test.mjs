import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRouterLedger, verifyRouterLedger } from '../src/litellm-router/ledger.mjs';
import { tempWorkspace } from './helpers.mjs';

test('router ledger preserves a valid chain across appends', async () => {
  const workspace = await tempWorkspace('router-ledger-');
  const ledger = join(workspace, 'runtime', 'router.jsonl');
  await appendRouterLedger(ledger, { request_id: 'one', status: 'PASS' });
  await appendRouterLedger(ledger, { request_id: 'two', status: 'BLOCKED', error_code: 'TEST' });
  const verification = await verifyRouterLedger(ledger);
  assert.equal(verification.valid, true);
  assert.equal(verification.count, 2);
  assert.match(verification.last_hash, /^[0-9a-f]{64}$/u);
});

test('router ledger rejects a symlink as the final ledger path', async () => {
  const workspace = await tempWorkspace('router-ledger-');
  const directory = join(workspace, 'runtime');
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'target.jsonl');
  const link = join(directory, 'router.jsonl');
  await appendRouterLedger(target, { request_id: 'seed', status: 'PASS' });
  await symlink(target, link);
  await assert.rejects(() => appendRouterLedger(link, { request_id: 'blocked', status: 'PASS' }), /symlink|ELOOP/u);
});
