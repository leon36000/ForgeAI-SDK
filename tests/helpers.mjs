import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sealEvidenceBundle } from '../src/evidence.mjs';
import { taskEnvelopeHash } from '../src/contracts.mjs';

export async function tempWorkspace(prefix = 'forgeai-test-') {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(workspace, 'src'), { recursive: true });
  await mkdir(join(workspace, 'tests'), { recursive: true });
  return workspace;
}

export function sampleTask(workspace, overrides = {}) {
  const base = {
    schema_version: 'forgeai.task-envelope.v0.1.1',
    task_id: 'task-001',
    title: 'Test task',
    objective: 'Prove a bounded change.',
    role: 'writer',
    mode: 'EXECUTE',
    risk: 'R1',
    task_kind: 'feature',
    base_commit: '0123456789abcdef0123456789abcdef01234567',
    workspace,
    allowed_paths: ['src/**', 'tests/**'],
    denied_paths: ['src/secrets/**'],
    allowed_bash_commands: ['npm test', 'npm run lint', 'git status --short'],
    required_test_commands: ['npm test', 'npm run lint'],
    allowed_network_hosts: [],
    allowed_mcp_tools: ['mcp__litellm__consult'],
    acceptance_criteria: [{ id: 'AC1', statement: 'Tests pass.', verification: 'Run npm test.' }],
    execution: { harness: 'claude-code', qualified: true, sandbox_required: true, sandbox_verified: true },
    delegation: { agent_depth: 0, max_parallel_agents: 1, allow_nested_agents: false },
    evidence_dir: join(workspace, '.forgeai', 'evidence', 'task-001'),
    created_at: '2026-08-13T00:00:00.000Z',
    expires_at: '2099-08-13T00:00:00.000Z',
    metadata: { writer_model: 'qualified-writer', writer_session_id: 'writer-session' },
  };
  return deepMerge(base, overrides);
}

function deepMerge(base, patch) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else result[key] = value;
  }
  return result;
}

export function sampleEvidence(task, overrides = {}) {
  const body = {
    task_id: task.task_id,
    task_envelope_hash: taskEnvelopeHash(task),
    base_commit: task.base_commit,
    final_commit: task.base_commit,
    generated_at: '2026-08-13T01:00:00.000Z',
    changed_files: [],
    git: { head: task.base_commit, clean: true, base_is_ancestor: true },
    gates: task.required_test_commands.map((command, index) => ({ id: `gate-${index}`, category: 'unit', command, status: 'PASS', exit_code: 0, duration_ms: 1, stdout_sha256: 'a'.repeat(64), stderr_sha256: 'b'.repeat(64) })),
    acceptance: task.acceptance_criteria.map((criterion) => ({ id: criterion.id, status: 'PASS', evidence: 'gate-0' })),
    reviews: [{ role: 'reviewer', model: 'qualified-reviewer', session_id: 'reviewer-session', verdict: 'PASS', context_fresh: true, findings_count: 0, evidence_hash: 'c'.repeat(64), final_commit: task.base_commit }],
    findings: [],
    artifacts: [],
    ledger_head: { count: 1, last_hash: 'd'.repeat(64) },
    human_approval: null,
  };
  return sealEvidenceBundle(deepMerge(body, overrides));
}

export function runGit(workspace, args) {
  const result = spawnSync('git', ['-C', workspace, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export async function initGitRepo(workspace) {
  runGit(workspace, ['init', '-q']);
  runGit(workspace, ['config', 'user.email', 'forgeai@example.invalid']);
  runGit(workspace, ['config', 'user.name', 'ForgeAI Test']);
  await writeFile(join(workspace, 'src', 'index.js'), 'export const value = 1;\n');
  await writeFile(join(workspace, 'tests', 'index.test.js'), 'test placeholder\n');
  runGit(workspace, ['add', '.']);
  runGit(workspace, ['commit', '-qm', 'base']);
  return runGit(workspace, ['rev-parse', 'HEAD']);
}
