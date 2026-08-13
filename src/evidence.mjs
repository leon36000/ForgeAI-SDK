import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { EVIDENCE_SCHEMA_VERSION, taskEnvelopeHash } from './contracts.mjs';
import { assertIsoDate, hashCanonical, isPlainObject, sha256, uniqSorted } from './utils.mjs';
import { toPosixPath } from './glob.mjs';

const BUNDLE_KEYS = [
  'schema_version', 'task_id', 'task_envelope_hash', 'base_commit', 'final_commit', 'generated_at',
  'changed_files', 'git', 'gates', 'acceptance', 'reviews', 'findings', 'artifacts', 'ledger_head',
  'human_approval', 'bundle_hash',
];

export function sealEvidenceBundle(bundleValue) {
  const bundle = structuredClone(bundleValue);
  bundle.schema_version = EVIDENCE_SCHEMA_VERSION;
  delete bundle.bundle_hash;
  bundle.changed_files = uniqSorted(bundle.changed_files ?? []);
  bundle.gates = [...(bundle.gates ?? [])].sort((a, b) => `${a.id}:${a.command}`.localeCompare(`${b.id}:${b.command}`));
  bundle.acceptance = [...(bundle.acceptance ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  bundle.reviews = [...(bundle.reviews ?? [])].sort((a, b) => `${a.role}:${a.model}`.localeCompare(`${b.role}:${b.model}`));
  bundle.findings = [...(bundle.findings ?? [])].sort((a, b) => `${a.severity}:${a.code}:${a.path ?? ''}`.localeCompare(`${b.severity}:${b.code}:${b.path ?? ''}`));
  bundle.artifacts = [...(bundle.artifacts ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  bundle.bundle_hash = hashCanonical(bundle);
  return Object.freeze(bundle);
}

export function verifyEvidenceBundle(bundle, task) {
  const findings = [];
  if (!isPlainObject(bundle)) return { valid: false, findings: [{ code: 'BUNDLE_INVALID' }] };
  const unexpected = Object.keys(bundle).filter((key) => !BUNDLE_KEYS.includes(key));
  if (unexpected.length) findings.push({ code: 'BUNDLE_UNEXPECTED_KEYS', keys: unexpected });
  if (bundle.schema_version !== EVIDENCE_SCHEMA_VERSION) findings.push({ code: 'BUNDLE_SCHEMA' });
  if (bundle.task_id !== task.task_id) findings.push({ code: 'BUNDLE_TASK_ID' });
  try {
    if (bundle.task_envelope_hash !== taskEnvelopeHash(task)) findings.push({ code: 'BUNDLE_TASK_HASH' });
  } catch (error) {
    findings.push({ code: 'BUNDLE_TASK_INVALID', message: error.message });
  }
  if (bundle.base_commit !== task.base_commit) findings.push({ code: 'BUNDLE_BASE_COMMIT' });
  if (!/^[0-9a-f]{7,64}$/iu.test(bundle.final_commit ?? '')) findings.push({ code: 'BUNDLE_FINAL_COMMIT' });
  try { assertIsoDate(bundle.generated_at, 'bundle.generated_at'); } catch (error) { findings.push({ code: 'BUNDLE_DATE', message: error.message }); }
  if (!Array.isArray(bundle.changed_files) || bundle.changed_files.some((item) => typeof item !== 'string')) findings.push({ code: 'BUNDLE_CHANGED_FILES' });
  if (!isPlainObject(bundle.git)) findings.push({ code: 'BUNDLE_GIT' });
  if (!Array.isArray(bundle.gates)) findings.push({ code: 'BUNDLE_GATES' });
  else for (const gate of bundle.gates) {
    if (!isPlainObject(gate) || typeof gate.id !== 'string' || typeof gate.category !== 'string' || typeof gate.command !== 'string') findings.push({ code: 'BUNDLE_GATE_SHAPE' });
    else {
      if (!['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'].includes(gate.status)) findings.push({ code: 'BUNDLE_GATE_STATUS', id: gate.id });
      if (!Number.isInteger(gate.exit_code)) findings.push({ code: 'BUNDLE_GATE_EXIT', id: gate.id });
      if (!Number.isFinite(gate.duration_ms) || gate.duration_ms < 0) findings.push({ code: 'BUNDLE_GATE_DURATION', id: gate.id });
      for (const key of ['stdout_sha256', 'stderr_sha256']) if (!/^[0-9a-f]{64}$/u.test(gate[key] ?? '')) findings.push({ code: 'BUNDLE_GATE_HASH', id: gate.id, field: key });
    }
  }
  if (!Array.isArray(bundle.acceptance)) findings.push({ code: 'BUNDLE_ACCEPTANCE' });
  if (!Array.isArray(bundle.reviews)) findings.push({ code: 'BUNDLE_REVIEWS' });
  else for (const review of bundle.reviews) {
    if (!isPlainObject(review) || typeof review.role !== 'string' || typeof review.model !== 'string' || typeof review.session_id !== 'string') findings.push({ code: 'BUNDLE_REVIEW_SHAPE' });
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(review?.verdict)) findings.push({ code: 'BUNDLE_REVIEW_VERDICT' });
    if (review?.context_fresh !== true && review?.context_fresh !== false) findings.push({ code: 'BUNDLE_REVIEW_CONTEXT' });
  }
  if (!Array.isArray(bundle.findings)) findings.push({ code: 'BUNDLE_FINDINGS' });
  if (!Array.isArray(bundle.artifacts)) findings.push({ code: 'BUNDLE_ARTIFACTS' });
  if (!isPlainObject(bundle.ledger_head) || !Number.isInteger(bundle.ledger_head.count) || !/^[0-9a-f]{64}$/u.test(bundle.ledger_head.last_hash ?? '')) findings.push({ code: 'BUNDLE_LEDGER_HEAD' });
  const copy = structuredClone(bundle);
  const actualHash = copy.bundle_hash;
  delete copy.bundle_hash;
  if (!/^[0-9a-f]{64}$/u.test(actualHash ?? '') || actualHash !== hashCanonical(copy)) findings.push({ code: 'BUNDLE_HASH' });
  return Object.freeze({ valid: findings.length === 0, findings });
}

async function walk(root, cursor, out) {
  for (const name of await readdir(cursor)) {
    const absolute = join(cursor, name);
    const stat = await lstat(absolute);
    const rel = toPosixPath(relative(root, absolute));
    if (stat.isSymbolicLink()) throw new Error(`artifact symlink forbidden: ${rel}`);
    if (stat.isDirectory()) await walk(root, absolute, out);
    else if (stat.isFile()) {
      const bytes = await readFile(absolute);
      out.push({ path: rel, bytes: stat.size, sha256: sha256(bytes) });
    } else {
      throw new Error(`unsupported artifact type: ${rel}`);
    }
  }
}

export async function buildArtifactManifest(directory) {
  const root = resolve(directory);
  const out = [];
  await walk(root, root, out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function verifyArtifactManifest(directory, manifest) {
  const actual = await buildArtifactManifest(directory);
  const valid = hashCanonical(actual) === hashCanonical([...manifest].sort((a, b) => a.path.localeCompare(b.path)));
  return Object.freeze({ valid, actual });
}
