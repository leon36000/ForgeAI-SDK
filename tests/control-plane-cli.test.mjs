import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sampleTask, tempWorkspace } from './helpers.mjs';

function run(args) {
  return spawnSync(process.execPath, ['bin/forgeai-control-plane.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });
}

test('control-plane CLI prints bounded usage', () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /forgeai-control-plane commands/u);
  assert.equal(result.stderr, '');
});

test('doctor fails closed when exact SDK is unavailable', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.expected.package, '@anthropic-ai/claude-agent-sdk');
  assert.equal(report.expected.version, '0.3.232');
  assert.match(report.error, /unavailable/u);
});

test('run rejects an invalid task before attempting SDK load', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeai-cli-'));
  const taskPath = join(directory, 'task.json');
  await writeFile(taskPath, '{}\n');
  const result = run(['run', taskPath, 'config/control-plane-policy.json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /task envelope|schema_version|unsupported task schema/u);
  assert.doesNotMatch(result.stderr, /SDK unavailable/u);
});

test('run rejects an invalid policy before attempting SDK load', async () => {
  const workspace = await tempWorkspace('forgeai-cli-task-');
  const task = sampleTask(workspace);
  const directory = await mkdtemp(join(tmpdir(), 'forgeai-cli-'));
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
  assert.equal(pkg.version, '0.2.0-alpha.1');
  assert.equal(pkg.bin['forgeai-control-plane'], './bin/forgeai-control-plane.mjs');
  assert.equal(pkg.scripts['control-plane'], 'node bin/forgeai-control-plane.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
