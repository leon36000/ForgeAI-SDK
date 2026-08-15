#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAdvisoryRouter } from '../src/litellm-router/router.mjs';
import { createMcpServer } from '../src/litellm-router/mcp-server.mjs';
import { validateAdvisoryRequest, validateRouterPolicy } from '../src/litellm-router/contracts.mjs';

function usage() {
  return 'usage: forgeai-litellm-router <doctor|run|serve-mcp> [--policy PATH] [--request PATH] [--ledger PATH]\n';
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, policy: 'config/litellm-router-policy.json', request: null, ledger: null };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!['--policy', '--request', '--ledger'].includes(flag)) throw new Error(`unknown argument: ${flag}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace('-', '_')] = value;
    index += 1;
  }
  return options;
}

async function jsonFile(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!['doctor', 'run', 'serve-mcp'].includes(options.command)) throw new Error(usage().trim());
  const policy = validateRouterPolicy(await jsonFile(options.policy));
  const router = createAdvisoryRouter({ policy, env: process.env, ledgerPath: options.ledger ? resolve(options.ledger) : null });
  if (options.command === 'doctor') {
    const report = router.doctor();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 2;
    return;
  }
  if (options.command === 'run') {
    if (!options.request) throw new Error('--request is required for run');
    const request = validateAdvisoryRequest(await jsonFile(options.request));
    const result = await router.run(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'BLOCKED' ? 2 : 0;
    return;
  }
  createMcpServer({ router });
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'BLOCKED', code: error.code ?? 'CLI_ERROR', message: error.message })}\n`);
  process.exitCode = 2;
});
