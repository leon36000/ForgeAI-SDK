import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { initGitRepo, tempWorkspace } from './helpers.mjs';

function run(args) {
  return spawnSync(process.execPath, ['scripts/install-into-repo.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });
}

test('installer defaults to dry-run and makes no changes', async () => {
  const repo = await tempWorkspace('install-'); await initGitRepo(repo);
  const result = run([repo]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /DRY_RUN/u);
  await assert.rejects(() => access(`${repo}/.forgeai/foundation/package.json`));
});

test('installer applies runtime, agents, hooks and ignores volatile state', async () => {
  const repo = await tempWorkspace('install-'); await initGitRepo(repo);
  const result = run([repo, '--apply']);
  assert.equal(result.status, 0, result.stderr);
  await access(`${repo}/.forgeai/foundation/bin/forgeai-foundation.mjs`);
  await access(`${repo}/.claude/agents/forgeai-writer.md`);
  await access(`${repo}/.claude/hooks/forgeai-hook.mjs`);
  const settings = JSON.parse(await readFile(`${repo}/.claude/settings.json`, 'utf8'));
  assert.ok(settings.hooks.PreToolUse.length > 0);
  const ignore = await readFile(`${repo}/.gitignore`, 'utf8');
  assert.match(ignore, /\.forgeai\/runtime\//u);
});

test('installer refuses a second apply without force', async () => {
  const repo = await tempWorkspace('install-'); await initGitRepo(repo);
  assert.equal(run([repo, '--apply']).status, 0);
  assert.notEqual(run([repo, '--apply']).status, 0);
});
