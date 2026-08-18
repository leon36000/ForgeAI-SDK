import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteJson, atomicWriteText, canonicalize, hashCanonical, readJson, sha256 } from '../src/utils.mjs';
import { matchesAny, matchesGlob, toPosixPath } from '../src/glob.mjs';
import { normalizedTaskEnvelope, taskEnvelopeHash, validateTaskEnvelope } from '../src/contracts.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

for (const [name, value, expected] of [
  ['sorts keys', { z: 1, a: 2 }, '{"a":2,"z":1}'],
  ['normalizes minus zero', { n: -0 }, '{"n":0}'],
  ['nested deterministic', { z: [{ b: 2, a: 1 }] }, '{"z":[{"a":1,"b":2}]}'],
]) test(`canonicalize ${name}`, () => assert.equal(canonicalize(value), expected));

test('canonicalize rejects non-finite number', () => assert.throws(() => canonicalize({ n: Infinity }), /non-finite/u));
test('canonicalize rejects undefined', () => assert.throws(() => canonicalize({ n: undefined }), /unsupported/u));
test('canonicalize rejects cycles', () => { const value = {}; value.self = value; assert.throws(() => canonicalize(value), /cyclic/u); });
test('sha256 is deterministic', () => assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('hashCanonical ignores insertion order', () => assert.equal(hashCanonical({ a: 1, b: 2 }), hashCanonical({ b: 2, a: 1 })));

for (const [path, pattern, expected] of [
  ['src/a.js', 'src/**', true], ['src/nested/a.js', 'src/**', true], ['tests/a.js', 'src/**', false],
  ['src/a.js', 'src/*.js', true], ['src/nested/a.js', 'src/*.js', false], ['src/a.ts', 'src/?.ts', true],
  ['a/b/c.txt', '**/*.txt', true], ['a.txt', '**/*.txt', true], ['a/b/c.txt', 'a/**/c.txt', true],
]) test(`glob ${pattern} on ${path}`, () => assert.equal(matchesGlob(path, pattern), expected));
test('glob normalizes windows separators', () => assert.equal(toPosixPath('src\\a.js'), 'src/a.js'));
test('matchesAny supports multiple patterns', () => assert.equal(matchesAny('tests/a.js', ['src/**', 'tests/**']), true));
test('glob rejects control characters', () => assert.throws(() => matchesGlob('src/a.js', 'src/\n**'), /control/u));

test('valid task envelope passes and hashes', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  assert.equal(validateTaskEnvelope(task), task);
  assert.match(taskEnvelopeHash(task), /^[0-9a-f]{64}$/u);
});

test('normalization sorts set-like fields', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { allowed_paths: ['tests/**', 'src/**', 'src/**'] });
  assert.deepEqual(normalizedTaskEnvelope(task).allowed_paths, ['src/**', 'tests/**']);
});

test('task accepts semantically identical required and allowed commands',async()=>{const w=await tempWorkspace();const t=sampleTask(w,{allowed_bash_commands:['npm   test'],required_test_commands:['npm test']});assert.equal(validateTaskEnvelope(t),t);});
test('task rejects missing writer session',async()=>{const w=await tempWorkspace();const t=sampleTask(w);delete t.metadata.writer_session_id;assert.throws(()=>validateTaskEnvelope(t),/writer_session_id/u);});
test('task rejects missing writer model',async()=>{const w=await tempWorkspace();const t=sampleTask(w);delete t.metadata.writer_model;assert.throws(()=>validateTaskEnvelope(t),/writer_model/u);});

for (const [name, patch, pattern] of [
  ['unknown schema', { schema_version: 'x' }, /unsupported/u],
  ['bad role', { role: 'coder' }, /invalid role/u],
  ['bad mode', { mode: 'WRITE' }, /invalid mode/u],
  ['bad risk', { risk: 'R9' }, /invalid risk/u],
  ['expired', { created_at: '2025-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:00:00.000Z' }, /expired/u],
  ['invalid lifetime', { created_at: '2026-08-13T00:00:00.000Z', expires_at: '2026-01-01T00:00:00.000Z' }, /later than created_at/u],
  ['missing sandbox', { execution: { sandbox_verified: false } }, /verified sandbox/u],
  ['unqualified harness', { execution: { qualified: false } }, /qualified harness/u],
  ['nested agents', { delegation: { allow_nested_agents: true } }, /nested agents/u],
  ['fanout too high', { delegation: { max_parallel_agents: 5 } }, /between 1 and 4/u],
  ['required command not allowed', { required_test_commands: ['npm run security'] }, /not allowed/u],
  ['read-only writer', { mode: 'REVIEW' }, /writer role requires EXECUTE/u],
  ['writerless execute', { role: 'reviewer' }, /restricted to writer/u],
  ['duplicate acceptance', { acceptance_criteria: [{ id: 'AC1', statement: 'a', verification: 'a' }, { id: 'AC1', statement: 'b', verification: 'b' }] }, /duplicate/u],
  ['relative workspace', { workspace: 'relative/repo', evidence_dir: 'relative/repo/.forgeai/evidence/task-001' }, /absolute/u],
  ['too many path rules', { allowed_paths: Array.from({ length: 257 }, (_, index) => `src/path-${index}/**`) }, /at most 256/u],
  ['shell syntax in allowlist', { allowed_bash_commands: ['npm test; echo bypass'], required_test_commands: ['npm test; echo bypass'] }, /shell syntax/u],
  ['unexpected key', { surprise: true }, /unexpected keys/u],
]) test(`task rejects ${name}`, async () => {
  const workspace = await tempWorkspace();
  assert.throws(() => validateTaskEnvelope(sampleTask(workspace, patch)), pattern);
});


test('glob rejects oversized patterns',()=>assert.throws(()=>matchesGlob('src/a.js',`src/${'*'.repeat(513)}`),/too long/u));
test('glob rejects oversized paths',()=>assert.throws(()=>matchesGlob(`src/${'a'.repeat(4097)}`,'src/**'),/too long/u));
test('glob handles adversarial wildcard sequences deterministically',()=>assert.equal(matchesGlob(`${'a'.repeat(240)}y`,`${'**a'.repeat(80)}z`),false));
test('readJson rejects symlinks and oversized JSON',async()=>{const w=await tempWorkspace();const t=join(w,'t.json');const l=join(w,'l.json');await writeFile(t,JSON.stringify({value:'12345'}));await symlink(t,l);await assert.rejects(()=>readJson(l),/symbolic link/u);await assert.rejects(()=>readJson(t,{maxBytes:4}),/maximum size/u);});
test('atomicWriteJson leaves no temporary residue',async()=>{const w=await tempWorkspace();const p=join(w,'atomic.json');await atomicWriteJson(p,{z:1,a:2});assert.deepEqual(await readJson(p),{a:2,z:1});assert.deepEqual((await readdir(w)).filter(x=>x.includes('.tmp-')),[]);});
test('atomicWriteText replaces symlink without following it',async()=>{const w=await tempWorkspace('atomic-');const o=await tempWorkspace('atomic-o-');const out=join(o,'outside');const p=join(w,'marker');await writeFile(out,'outside');await symlink(out,p);await atomicWriteText(p,'inside\n');assert.equal(await readFile(out,'utf8'),'outside');assert.equal(await readFile(p,'utf8'),'inside\n');});
