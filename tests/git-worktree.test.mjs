import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectGitState, verifyGitScope } from '../src/git-proof.mjs';
import { createManagedWorktree, removeManagedWorktree } from '../src/worktree.mjs';
import { initGitRepo, runGit, sampleTask, tempWorkspace } from './helpers.mjs';

test('fresh git state binds exact head and changed files', async () => {
  const workspace=await tempWorkspace('git-'); const base=await initGitRepo(workspace); await writeFile(join(workspace,'src','index.js'),'export const value = 2;\n'); runGit(workspace,['add','.']); runGit(workspace,['commit','-qm','change']); const head=runGit(workspace,['rev-parse','HEAD']); const state=inspectGitState(workspace,base,head); assert.equal(state.clean,true); assert.deepEqual(state.changed_files,['src/index.js']);
});
test('dirty worktree is reported', async () => {
  const workspace=await tempWorkspace('git-'); const base=await initGitRepo(workspace); await writeFile(join(workspace,'src','dirty.js'),'x'); const state=inspectGitState(workspace,base,base); assert.equal(state.clean,false);
});
test('head mismatch is rejected', async () => {
  const workspace=await tempWorkspace('git-'); const base=await initGitRepo(workspace); assert.throws(()=>inspectGitState(workspace,base,'f'.repeat(40)),/HEAD mismatch/u);
});
test('non-ancestor base is rejected', async () => {
  const workspace=await tempWorkspace('git-'); const base=await initGitRepo(workspace); assert.throws(()=>inspectGitState(workspace,'f'.repeat(40),base),/ancestor/u);
});
test('git scope accepts allowed change', async () => {
  const workspace=await tempWorkspace('git-'); const task=sampleTask(workspace); const state={clean:true,changed_files:['src/index.js']}; assert.equal(verifyGitScope(state,task).valid,true);
});
test('git scope rejects outside change', async () => {
  const workspace=await tempWorkspace('git-'); const task=sampleTask(workspace); const result=verifyGitScope({clean:true,changed_files:['docs/readme.md']},task); assert.equal(result.valid,false); assert.equal(result.findings[0].code,'GIT_OUT_OF_SCOPE');
});
test('git scope rejects denied change', async () => {
  const workspace=await tempWorkspace('git-'); const task=sampleTask(workspace); const result=verifyGitScope({clean:true,changed_files:['src/secrets/x.js']},task); assert.equal(result.valid,false); assert.ok(result.findings.some((item)=>item.code==='GIT_DENIED_PATH'));
});
test('managed worktree creates isolated branch and removes only with bound PASS proof', async () => {
  const repo=await tempWorkspace('repo-'); const base=await initGitRepo(repo); const created=await createManagedWorktree(repo,'task-worktree',base); assert.equal(runGit(created.target,['rev-parse','HEAD']),base); await mkdir(join(created.target,'.forgeai','runtime'),{recursive:true}); await writeFile(join(created.target,'.forgeai','runtime','latest-proof.json'),JSON.stringify({verdict:'PASS',final_commit:base})); const removed=await removeManagedWorktree(repo,'task-worktree'); assert.equal(removed.removed,true);
});
test('managed worktree refuses removal without proof', async () => {
  const repo=await tempWorkspace('repo-'); const base=await initGitRepo(repo); await createManagedWorktree(repo,'task-no-proof',base); await assert.rejects(()=>removeManagedWorktree(repo,'task-no-proof'),/without a PASS proof/u); await removeManagedWorktree(repo,'task-no-proof',{force:true});
});
test('managed worktree refuses dirty removal', async () => {
  const repo=await tempWorkspace('repo-'); const base=await initGitRepo(repo); const created=await createManagedWorktree(repo,'task-dirty',base); await writeFile(join(created.target,'src','dirty.js'),'x'); await assert.rejects(()=>removeManagedWorktree(repo,'task-dirty'),/dirty/u); await removeManagedWorktree(repo,'task-dirty',{force:true});
});
