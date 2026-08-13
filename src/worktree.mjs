import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gitCommand } from './git-proof.mjs';

export async function createManagedWorktree(repoValue, taskId, baseCommit) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(taskId)) throw new Error('invalid task id');
  const repo = resolve(repoValue);
  const worktreesRoot = join(repo, '.forgeai', 'worktrees');
  const target = join(worktreesRoot, taskId);
  await mkdir(worktreesRoot, { recursive: true });
  const branch = `forgeai/${taskId}`;
  gitCommand(repo, ['worktree', 'add', '-b', branch, target, baseCommit]);
  return Object.freeze({ repo, target, branch, base_commit: baseCommit });
}

export async function removeManagedWorktree(repoValue, taskId, { force = false } = {}) {
  const repo = resolve(repoValue);
  const target = join(repo, '.forgeai', 'worktrees', taskId);
  if (!force) {
    const status = gitCommand(target, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).forgeai/runtime/**', ':(exclude).forgeai/ledger/**', ':(exclude).forgeai/evidence/**']).stdout;
    if (status !== '') throw new Error('refusing to remove dirty worktree');
    let proof;
    try {
      proof = JSON.parse(await readFile(join(target, '.forgeai', 'runtime', 'latest-proof.json'), 'utf8'));
    } catch {
      throw new Error('refusing to remove worktree without a PASS proof; use force only for explicit abandonment');
    }
    const head = gitCommand(target, ['rev-parse', 'HEAD']).stdout;
    if (proof.verdict !== 'PASS' || proof.final_commit !== head) throw new Error('refusing to remove worktree with stale or blocked proof');
  }
  // Git refuses to remove a worktree containing ignored runtime evidence.
  // Once the worktree has passed the clean-state and proof checks above,
  // --force is safe and necessary to delete those deliberately volatile files.
  gitCommand(repo, ['worktree', 'remove', '--force', target]);
  await rm(target, { recursive: true, force: true });
  return Object.freeze({ removed: true, target });
}
