import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempWorkspace } from './helpers.mjs';

const checker = fileURLToPath(new URL('../scripts/check-sarif.mjs', import.meta.url));

async function runSarif(document) {
  const workspace = await tempWorkspace('sarif-gate-');
  const directory = join(workspace, 'codeql-results');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'javascript.sarif'), `${JSON.stringify(document)}\n`);
  return spawnSync(process.execPath, [checker, directory], { cwd: workspace, encoding: 'utf8' });
}

test('CodeQL gate fails closed on a result without automationDetails', async () => {
  const result = await runSarif({
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'CodeQL', rules: [] } },
      results: [{ ruleId: 'js/file-system-race', message: { text: 'The file may have changed since it was checked.' } }],
    }],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CodeQL BLOCKED: 1 SARIF result/u);
});

test('CodeQL gate passes when every SARIF run has zero results', async () => {
  const result = await runSarif({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'CodeQL', rules: [] } }, results: [] }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CodeQL PASS .*0 results/u);
});
