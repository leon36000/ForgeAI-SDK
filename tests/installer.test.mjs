import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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
  const hookCommands = Object.values(settings.hooks).flatMap((entries) =>
    entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hook.command)),
  );
  assert.ok(hookCommands.every((command) => command.includes('${CLAUDE_PROJECT_DIR}')));
  const ignore = await readFile(`${repo}/.gitignore`, 'utf8');
  assert.match(ignore, /\.forgeai\/runtime\//u);
});

test('installed hook resolves project root and converts internal failures to exit 2', async () => {
  const repo = await tempWorkspace('install-'); await initGitRepo(repo);
  assert.equal(run([repo, '--apply']).status, 0);
  const nested = join(repo, 'src', 'nested');
  await mkdir(nested, { recursive: true });
  const hook = join(repo, '.claude', 'hooks', 'forgeai-hook.mjs');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };

  const unsupported = spawnSync(process.execPath, [hook, 'Unknown'], {
    cwd: nested,
    env,
    input: '',
    encoding: 'utf8',
  });
  assert.equal(unsupported.status, 2, unsupported.stderr);
  assert.match(unsupported.stderr, /unsupported hook event: Unknown/u);

  await rm(join(repo, '.forgeai', 'foundation', 'bin', 'forgeai-foundation.mjs'));
  const missingRuntime = spawnSync(process.execPath, [hook, 'Unknown'], {
    cwd: nested,
    env,
    input: '',
    encoding: 'utf8',
  });
  assert.equal(missingRuntime.status, 2, missingRuntime.stderr);
  assert.match(missingRuntime.stderr, /MODULE_NOT_FOUND|Cannot find module/u);
});

test('installer refuses a second apply without force', async () => {
  const repo = await tempWorkspace('install-'); await initGitRepo(repo);
  assert.equal(run([repo, '--apply']).status, 0);
  assert.notEqual(run([repo, '--apply']).status, 0);
});
