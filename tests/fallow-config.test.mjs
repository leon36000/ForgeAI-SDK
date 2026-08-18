import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as contracts from '../src/litellm-router/contracts.mjs';

const EXPECTED_ENTRIES = [
  'tests/**/*.test.mjs',
  'scripts/check-manifest.mjs',
  'scripts/security-audit.mjs',
  'scripts/install-into-repo.mjs',
];

test('Fallow entry points describe dynamically invoked tests and scripts exactly', async () => {
  const config = JSON.parse(await readFile(new URL('../.fallowrc.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config), ['entry']);
  assert.deepEqual(config.entry, EXPECTED_ENTRIES);
});

test('private contracts module no longer exports unused CONTRACT_PATTERNS aggregate', () => {
  assert.equal(Object.hasOwn(contracts, 'CONTRACT_PATTERNS'), false);
});
