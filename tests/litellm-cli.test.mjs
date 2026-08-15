import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { policy, qualifiedRoute, request } from './litellm-router-helpers.mjs';

const cli = resolve('bin/forgeai-litellm-router.mjs');

test('doctor reports versioned routes as unqualified without leaking env values', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { ...process.env, FORGEAI_LITELLM_BASE_URL: 'http://127.0.0.1:4000', FORGEAI_LITELLM_API_KEY: 'super-secret-key' } });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.ready_routes, 0);
  assert.equal(result.stdout.includes('super-secret-key'), false);
});

test('run validates request before network access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeai-router-cli-'));
  const policyPath = join(dir, 'policy.json');
  const requestPath = join(dir, 'request.json');
  const unqualified = { ...qualifiedRoute('x', 'test/x'), status: 'UNQUALIFIED', qualification: null };
  await writeFile(policyPath, JSON.stringify(policy([unqualified])));
  await writeFile(requestPath, JSON.stringify(request()));
  const result = spawnSync(process.execPath, [cli, 'run', '--policy', policyPath, '--request', requestPath], { encoding: 'utf8', env: { ...process.env, TEST_LITELLM_URL: 'http://127.0.0.1:1', TEST_LITELLM_KEY: 'secret' } });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'NO_QUALIFIED_ROUTE');
});

test('CLI rejects unknown arguments fail-closed', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--execute'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument/u);
});
