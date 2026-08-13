#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const eventName = process.argv[2];
const input = readFileSync(0);
const result = spawnSync(process.execPath, ['.forgeai/foundation/bin/forgeai-foundation.mjs', 'hook', eventName], {
  input,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
