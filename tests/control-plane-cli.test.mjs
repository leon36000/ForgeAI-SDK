import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleTask } from './helpers.mjs';

function run(args) {
  return spawnSync(process.execPath, ['bin/forgeai-control-plane.mjs', ...args], { encoding: 'utf8' });
}

test('control-plane CLI prints bounded usage', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /forgeai-control-plane/u);
  assert.ok(result.stdout.length < 4096);
});

test('doctor fails closed when exact SDK is unavailable', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'BLOCKED');
  assert.equal(payload.expected.package, '@anthropic-ai/claude-agent-sdk');
  assert.equal(payload.expected.version, '0.3.232');
});

test('run rejects an invalid task before attempting SDK load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeai-control-plane-cli-'));
  const taskPath = join(directory, 'task.json');
  const policyPath = join(directory, 'policy.json');
  await writeFile(taskPath, '{}\n');
  await writeFile(policyPath, '{}\n');
  const result = run(['run', taskPath, policyPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TaskEnvelope|schema/u);
  assert.doesNotMatch(result.stderr, /SDK unavailable/u);
});

test('run rejects an invalid policy before attempting SDK load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeai-control-plane-cli-'));
  const task = sampleTask(directory);
  const taskPath = join(directory, 'task.json');
  const policyPath = join(directory, 'policy.json');
  await writeFile(taskPath, `${JSON.stringify(task)}\n`);
  await writeFile(policyPath, '{}\n');
  const result = run(['run', taskPath, policyPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /control-plane policy|schema/u);
  assert.doesNotMatch(result.stderr, /SDK unavailable/u);
});

test('package exposes the control-plane binary without root dependencies', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.bin['forgeai-control-plane'], './bin/forgeai-control-plane.mjs');
  assert.equal(pkg.scripts['control-plane'], 'node bin/forgeai-control-plane.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
