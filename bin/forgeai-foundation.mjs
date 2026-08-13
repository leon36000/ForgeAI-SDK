#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { appendLedgerEvent, initializeLedger, verifyLedger } from '../src/ledger.mjs';
import { validateTaskEnvelope } from '../src/contracts.mjs';
import { checkToolUse } from '../src/policy.mjs';
import { inspectGitState, verifyGitScope } from '../src/git-proof.mjs';
import { sealEvidenceBundle, verifyArtifactManifest } from '../src/evidence.mjs';
import { evaluateProof } from '../src/proof.mjs';
import { handleHook } from '../src/hook.mjs';
import { inventoryRepository } from '../src/inventory.mjs';
import { createBenchmarkSlots, computeBenchmarkMetrics } from '../src/benchmark.mjs';
import { createManagedWorktree, removeManagedWorktree } from '../src/worktree.mjs';
import { runRequiredGates } from '../src/gate-runner.mjs';
import { scanSecrets } from '../src/secret-scan.mjs';
import { canonicalize, readJson } from '../src/utils.mjs';

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function writeJson(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function usage() {
  return `forgeai-foundation commands:\n` +
    `  doctor [workspace]\n` +
    `  validate-task <task.json>\n` +
    `  policy-check <task.json> <tool-name> <tool-input.json>\n` +
    `  ledger-init <ledger-dir>\n` +
    `  ledger-append <ledger-dir> <event.json>\n` +
    `  ledger-verify <ledger-dir>\n` +
    `  inventory <workspace> <output.json>\n` +
    `  run-gates <task.json> <output.json>\n` +
    `  scan-secrets <workspace> <output.json>\n` +
    `  evidence-seal <draft.json> <output.json>\n` +
    `  proof-verify <task.json> <evidence.json> <artifact-dir> <ledger-dir> [output.json]\n` +
    `  benchmark-init <output.json>\n` +
    `  benchmark-metrics <runs.json> [output.json]\n` +
    `  worktree-create <repo> <task-id> <base-commit>\n` +
    `  worktree-remove <repo> <task-id> [--force]\n` +
    `  hook <event-name>\n`;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(usage());
    return;
  }
  if (command === 'doctor') {
    const report = await inventoryRepository(args[0] ?? '.');
    const required = ['node', 'git'];
    const missing = required.filter((key) => !report.tools[key]);
    const result = { ...report, status: missing.length === 0 ? 'PASS' : 'BLOCKED', missing_required_tools: missing };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (missing.length) process.exitCode = 2;
    return;
  }
  if (command === 'validate-task') {
    const task = await readJson(args[0]);
    validateTaskEnvelope(task);
    process.stdout.write(`${JSON.stringify({ valid: true, task_id: task.task_id })}\n`);
    return;
  }
  if (command === 'policy-check') {
    const task = await readJson(args[0]);
    const input = await readJson(args[2]);
    const result = checkToolUse(task, args[1], input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.allowed) process.exitCode = 2;
    return;
  }
  if (command === 'ledger-init') {
    const result = await initializeLedger(resolve(args[0]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'ledger-append') {
    const result = await appendLedgerEvent(resolve(args[0]), await readJson(args[1]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'ledger-verify') {
    const result = await verifyLedger(resolve(args[0]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'inventory') {
    const result = await inventoryRepository(args[0]);
    await writeJson(args[1], result);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', output: resolve(args[1]), files: result.files.length })}\n`);
    return;
  }

  if (command === 'run-gates') {
    const task = await readJson(args[0]);
    validateTaskEnvelope(task);
    const results = await runRequiredGates(task);
    await writeJson(args[1], results);
    const status = results.length === task.required_test_commands.length && results.every((item) => item.status === 'PASS') ? 'PASS' : 'BLOCKED';
    process.stdout.write(`${JSON.stringify({ status, output: resolve(args[1]), gates: results.length }, null, 2)}\n`);
    if (status !== 'PASS') process.exitCode = 2;
    return;
  }
  if (command === 'scan-secrets') {
    const result = await scanSecrets(args[0]);
    await writeJson(args[1], result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'PASS') process.exitCode = 2;
    return;
  }
  if (command === 'evidence-seal') {
    const result = sealEvidenceBundle(await readJson(args[0]));
    await writeJson(args[1], result);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', output: resolve(args[1]), bundle_hash: result.bundle_hash })}\n`);
    return;
  }

  if (command === 'proof-verify') {
    const [taskPath, evidencePath, artifactDir, ledgerDir, outputPath] = args;
    const task = await readJson(taskPath);
    const evidence = await readJson(evidencePath);
    validateTaskEnvelope(task);
    const ledgerVerification = await verifyLedger(resolve(ledgerDir));
    const gitState = inspectGitState(task.workspace, task.base_commit, evidence.final_commit);
    const gitScope = verifyGitScope(gitState, task);
    const artifactVerification = await verifyArtifactManifest(resolve(artifactDir), evidence.artifacts);
    const result = evaluateProof(task, evidence, { ledgerVerification, gitState, gitScope, artifactVerification });
    if (outputPath) await writeJson(outputPath, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.verdict !== 'PASS') process.exitCode = 2;
    return;
  }
  if (command === 'benchmark-init') {
    await writeJson(args[0], createBenchmarkSlots());
    process.stdout.write(`${JSON.stringify({ status: 'PASS', output: resolve(args[0]), slots: 15 })}\n`);
    return;
  }
  if (command === 'benchmark-metrics') {
    const result = computeBenchmarkMetrics(await readJson(args[0]));
    if (args[1]) await writeJson(args[1], result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'worktree-create') {
    const result = await createManagedWorktree(args[0], args[1], args[2]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'worktree-remove') {
    const result = await removeManagedWorktree(args[0], args[1], { force: args.includes('--force') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'hook') {
    const raw = await stdinText();
    const event = raw.trim() ? JSON.parse(raw) : {};
    const result = await handleHook(args[0], event);
    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  throw new Error(`unknown command: ${command}\n${usage()}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
