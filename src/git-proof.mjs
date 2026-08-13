import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { matchesAny, toPosixPath } from './glob.mjs';
import { isProtectedRepoPath } from './policy.mjs';

function git(workspace, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', workspace, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function inspectGitState(workspaceValue, baseCommit, finalCommit = undefined) {
  const workspace = resolve(workspaceValue);
  const top = git(workspace, ['rev-parse', '--show-toplevel']).stdout;
  if (resolve(top) !== workspace) throw new Error('workspace must be the Git top-level directory');
  const head = git(workspace, ['rev-parse', 'HEAD']).stdout;
  const final = finalCommit ?? head;
  if (head !== final) throw new Error(`HEAD mismatch: expected ${final}, got ${head}`);
  const ancestor = git(workspace, ['merge-base', '--is-ancestor', baseCommit, final], { allowFailure: true }).status === 0;
  if (!ancestor) throw new Error('base_commit is not an ancestor of final_commit');
  const status = git(workspace, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).forgeai/runtime/**', ':(exclude).forgeai/ledger/**', ':(exclude).forgeai/evidence/**', ':(exclude).forgeai/worktrees/**']).stdout;
  const changed = git(workspace, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${baseCommit}..${final}`]).stdout;
  const changedFiles = changed ? changed.split('\n').filter(Boolean).map(toPosixPath).sort() : [];
  return Object.freeze({ workspace, base_commit: baseCommit, final_commit: final, head, clean: status === '', changed_files: changedFiles });
}

export function verifyGitScope(state, task) {
  const findings = [];
  if (!state.clean) findings.push({ code: 'GIT_DIRTY', message: 'worktree is not clean' });
  for (const path of state.changed_files) {
    if (isProtectedRepoPath(path)) findings.push({ code: 'GIT_PROTECTED_PATH', path });
    if (matchesAny(path, task.denied_paths)) findings.push({ code: 'GIT_DENIED_PATH', path });
    if (!matchesAny(path, task.allowed_paths)) findings.push({ code: 'GIT_OUT_OF_SCOPE', path });
  }
  return Object.freeze({ valid: findings.length === 0, findings });
}

export function gitCommand(workspace, args) {
  return git(resolve(workspace), args);
}
