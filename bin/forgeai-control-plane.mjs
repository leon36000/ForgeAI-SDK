#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { validateTaskEnvelope } from '../src/contracts.mjs';
import { atomicWriteJson, readJson } from '../src/utils.mjs';
import { validateControlPlanePolicy } from '../src/control-plane/contracts.mjs';
import { loadClaudeAgentSdk } from '../src/control-plane/sdk-adapter.mjs';
import { isControlPlaneResult, runControlPlane } from '../src/control-plane/runner.mjs';
import { SUPPORTED_CLAUDE_AGENT_SDK } from '../src/control-plane/constants.mjs';

const DEFAULT_POLICY = resolve('config', 'control-plane-policy.json');

function usage() {
  return `forgeai-control-plane commands:
  doctor [policy.json]
  run <task.json> <policy.json> [result.json]
`;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await atomicWriteJson(target, value);
  return target;
}

async function doctor(policyPath = DEFAULT_POLICY) {
  const policy = await readJson(resolve(policyPath));
  validateControlPlanePolicy(policy);
  try {
    const sdk = await loadClaudeAgentSdk();
    const result = {
      schema_version: 'forgeai.control-plane-doctor.v0.2.0-alpha.1',
      status: 'PASS',
      expected: policy.sdk,
      installed: { package: sdk.package, version: sdk.version, entry: sdk.entry },
      node: process.version,
    };
    print(result);
  } catch (error) {
    const result = {
      schema_version: 'forgeai.control-plane-doctor.v0.2.0-alpha.1',
      status: 'BLOCKED',
      expected: { ...SUPPORTED_CLAUDE_AGENT_SDK },
      installed: null,
      node: process.version,
      error: error.message,
    };
    print(result);
    process.exitCode = 2;
  }
}

async function run(taskPath, policyPath, outputPath) {
  if (!taskPath || !policyPath) throw new Error(`run requires task.json and policy.json\n${usage()}`);
  const task = await readJson(resolve(taskPath));
  const policy = await readJson(resolve(policyPath));
  validateTaskEnvelope(task);
  validateControlPlanePolicy(policy);
  const result = await runControlPlane({ task, policy });
  if (!isControlPlaneResult(result)) throw new Error('control-plane runner returned an invalid result');
  if (outputPath) await writeJson(outputPath, result);
  print(result);
  if (result.verdict !== 'PASS') process.exitCode = 2;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(usage());
    return;
  }
  if (command === 'doctor') {
    await doctor(args[0] ?? DEFAULT_POLICY);
    return;
  }
  if (command === 'run') {
    await run(args[0], args[1], args[2]);
    return;
  }
  throw new Error(`unknown command: ${command}\n${usage()}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
