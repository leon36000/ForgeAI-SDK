import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildArtifactManifest, verifyArtifactManifest, verifyEvidenceBundle } from '../src/evidence.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';

test('seals and verifies evidence bundle', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = sampleEvidence(task);
  assert.equal(verifyEvidenceBundle(evidence, task).valid, true);
});
test('detects evidence tampering', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = structuredClone(sampleEvidence(task)); evidence.changed_files.push('src/evil.js');
  assert.equal(verifyEvidenceBundle(evidence, task).valid, false);
});
test('detects task hash mismatch', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = sampleEvidence(task); const changed = sampleTask(workspace,{title:'changed'});
  assert.equal(verifyEvidenceBundle(evidence, changed).valid, false);
});
test('artifact manifest is stable and verified', async () => {
  const dir = await tempWorkspace('artifacts-'); await writeFile(join(dir,'a.txt'),'a'); await mkdir(join(dir,'nested')); await writeFile(join(dir,'nested','b.txt'),'bb');
  const manifest=await buildArtifactManifest(dir); assert.deepEqual(manifest.map((item)=>item.path),['a.txt','nested/b.txt']); assert.equal((await verifyArtifactManifest(dir,manifest)).valid,true);
});
test('artifact manifest detects changed bytes', async () => {
  const dir = await tempWorkspace('artifacts-'); await writeFile(join(dir,'a.txt'),'a'); const manifest=await buildArtifactManifest(dir); await writeFile(join(dir,'a.txt'),'b'); assert.equal((await verifyArtifactManifest(dir,manifest)).valid,false);
});
test('artifact manifest rejects symlinks', async () => {
  const dir=await tempWorkspace('artifacts-'); const outside=await tempWorkspace('outside-'); await writeFile(join(outside,'a'),'x'); await symlink(join(outside,'a'),join(dir,'link')); await assert.rejects(()=>buildArtifactManifest(dir),/symlink/u);
});
