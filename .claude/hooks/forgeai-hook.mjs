#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function failClosed(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`ForgeAI hook failed closed: ${message}\n`);
  process.exitCode = 2;
}

try {
  const eventName = process.argv[2];
  if (typeof eventName !== 'string' || eventName.length === 0) throw new Error('hook event name is required');
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (typeof projectDir !== 'string' || projectDir.length === 0) throw new Error('CLAUDE_PROJECT_DIR is required');

  const input = readFileSync(0);
  const entrypoint = resolve(projectDir, '.forgeai', 'foundation', 'bin', 'forgeai-foundation.mjs');
  const result = spawnSync(process.execPath, [entrypoint, 'hook', eventName], {
    cwd: resolve(projectDir),
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 ? 0 : 2;
} catch (error) {
  failClosed(error);
}
