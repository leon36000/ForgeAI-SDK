import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkCommand } from './policy.mjs';
import { sha256 } from './utils.mjs';

const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

function safeGateId(value, index) {
  const normalized = String(value ?? `gate-${index + 1}`).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!normalized) throw new Error('gate id is invalid');
  return normalized.slice(0, 64);
}

export async function runDeclaredGate(task, gate, { index = 0, env = {}, timeoutMs = 15 * 60 * 1000 } = {}) {
  const policy = checkCommand(task, gate.command);
  if (!policy.allowed) throw new Error(`gate command denied: ${policy.reason}`);
  const id = safeGateId(gate.id, index);
  const outputDir = resolve(task.evidence_dir, 'gate-logs');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const started = Date.now();
  const child = spawn(gate.command, {
    cwd: task.workspace,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow = false;
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= MAX_CAPTURE_BYTES) stdout.push(chunk);
    else overflow = true;
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= MAX_CAPTURE_BYTES) stderr.push(chunk);
    else overflow = true;
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const { code, signal } = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, exitSignal) => resolvePromise({ code: exitCode, signal: exitSignal }));
  });
  clearTimeout(timeout);
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const stdoutPath = join(outputDir, `${id}.stdout.log`);
  const stderrPath = join(outputDir, `${id}.stderr.log`);
  await writeFile(stdoutPath, stdoutBuffer, { mode: 0o600 });
  await writeFile(stderrPath, stderrBuffer, { mode: 0o600 });
  const timedOut = signal === 'SIGKILL' && Date.now() - started >= timeoutMs;
  const status = code === 0 && !overflow && !timedOut ? 'PASS' : 'FAIL';
  return Object.freeze({
    id,
    category: gate.category,
    command: gate.command,
    status,
    exit_code: Number.isInteger(code) ? code : 128,
    signal: signal ?? null,
    timed_out: timedOut,
    output_overflow: overflow,
    duration_ms: Date.now() - started,
    stdout_sha256: sha256(stdoutBuffer),
    stderr_sha256: sha256(stderrBuffer),
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
  });
}

export async function runRequiredGates(task, options = {}) {
  const categories = options.categories ?? {};
  const results = [];
  for (const [index, command] of task.required_test_commands.entries()) {
    const result = await runDeclaredGate(task, {
      id: `required-${index + 1}`,
      category: categories[command] ?? 'unit',
      command,
    }, { ...options, index });
    results.push(result);
    if (result.status !== 'PASS' && options.stopOnFailure !== false) break;
  }
  return results;
}
