import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function run(name, command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return {
    name,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exit_code: result.status,
    duration_ms: Date.now() - started,
    stdout_sha256: createHash('sha256').update(result.stdout ?? '').digest('hex'),
    stderr_sha256: createHash('sha256').update(result.stderr ?? '').digest('hex'),
    stdout_tail: (result.stdout ?? '').split('\n').slice(-12).join('\n'),
    stderr_tail: (result.stderr ?? '').split('\n').slice(-12).join('\n'),
  };
}

const gates = [
  run('manifest', process.execPath, ['scripts/check-manifest.mjs']),
  run('lint', process.execPath, ['scripts/lint.mjs']),
  run('security-audit', process.execPath, ['scripts/security-audit.mjs']),
  run('tests', process.execPath, ['scripts/test.mjs']),
  run('doctor', process.execPath, ['bin/forgeai-foundation.mjs', 'doctor', '.']),
  run('validate-example', process.execPath, ['bin/forgeai-foundation.mjs', 'validate-task', 'examples/task-envelope.json']),
];
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const gitStatus = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
const sourceCommit = gitHead.status === 0 ? gitHead.stdout.trim() : null;
const sourceClean = gitStatus.status === 0 && gitStatus.stdout.trim() === '';
gates.push({ name: 'source-tree-clean', command: 'git status --porcelain=v1 --untracked-files=all', status: sourceClean ? 'PASS' : 'FAIL', exit_code: sourceClean ? 0 : 1, duration_ms: 0, stdout_sha256: createHash('sha256').update(gitStatus.stdout ?? '').digest('hex'), stderr_sha256: createHash('sha256').update(gitStatus.stderr ?? '').digest('hex'), stdout_tail: gitStatus.stdout ?? '', stderr_tail: gitStatus.stderr ?? '' });
const verdict = gates.every((gate) => gate.status === 'PASS') ? 'PASS' : 'BLOCKED';
const report = {
  schema_version: 'forgeai.release-verification.v0.1.1',
  package_version: JSON.parse(await readFile('package.json', 'utf8')).version,
  generated_at: new Date().toISOString(),
  node: process.version,
  source_commit: sourceCommit,
  source_tree_clean: sourceClean,
  verdict,
  gates,
};
await mkdir('verification', { recursive: true });
await writeFile('verification/verification-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile('verification/VERIFIED', verdict === 'PASS' ? `PASS ${report.generated_at}\n` : `BLOCKED ${report.generated_at}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (verdict !== 'PASS') process.exit(2);
