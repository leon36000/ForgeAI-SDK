import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCommand, parseCommandLine } from '../src/command.mjs';

test('command parser preserves quoted and escaped arguments', () => {
  assert.deepEqual(parseCommandLine('node -e "process.stdout.write(\\\"ok\\\")" "two words" empty\\ value'), ['node', '-e', 'process.stdout.write("ok")', 'two words', 'empty value']);
});
test('command parser preserves explicitly empty arguments', () => assert.deepEqual(parseCommandLine('node ""'), ['node', '']));
test('command canonicalization normalizes equivalent spelling', () => assert.equal(canonicalCommand(' npm   test '), 'npm test'));
for (const command of ['npm test; echo bypass','npm test | cat','npm test && echo bypass','npm test > out','npm test < in','npm test `id`']) {
  test(`command parser rejects shell syntax: ${command}`, () => assert.throws(() => parseCommandLine(command), /shell syntax/u));
}
test('command parser rejects unterminated quotes', () => assert.throws(() => parseCommandLine('node "unterminated'), /unterminated/u));
