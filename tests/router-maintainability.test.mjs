import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/litellm-router/router.mjs', import.meta.url), 'utf8');

function runBody(text) {
  const startMarker = '  async function run(requestValue) {';
  const endMarker = '\n\n  return Object.freeze({ policy, doctor, run });';
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'run() declaration must remain discoverable');
  assert.notEqual(end, -1, 'router factory return must remain discoverable');
  return text.slice(start, end);
}

test('router run delegates orchestration to bounded private helpers', () => {
  const expectedHelpers = [
    'prepareRequest',
    'selectQualifiedRoutes',
    'createAttemptPlan',
    'executeAttempt',
    'classifyAttempt',
    'recordAttempt',
    'finalizeResult',
  ];
  for (const helper of expectedHelpers) {
    assert.match(source, new RegExp(`(?:async\\s+)?function\\s+${helper}\\b`), `${helper} must be a private helper`);
  }

  const body = runBody(source);
  const nonBlankLines = body.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(nonBlankLines.length <= 40, `run() must stay orchestration-only; found ${nonBlankLines.length} non-blank lines`);
  for (const helper of expectedHelpers) {
    assert.match(body, new RegExp(`\\b${helper}\\b`), `run() must delegate through ${helper}`);
  }
});
