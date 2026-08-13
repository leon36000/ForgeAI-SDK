import { verifyEvidenceBundle } from './evidence.mjs';
import { taskEnvelopeHash, validateTaskEnvelope } from './contracts.mjs';

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function hasPassingReview(evidence, role, task) {
  return evidence.reviews.some((review) =>
    review.role === role && review.verdict === 'PASS' && review.context_fresh === true &&
    review.session_id !== task.metadata.writer_session_id && review.model !== task.metadata.writer_model
  );
}

export function evaluateProof(task, evidence, { ledgerVerification, gitState, gitScope, artifactVerification } = {}) {
  const findings = [];
  try {
    validateTaskEnvelope(task);
  } catch (error) {
    findings.push(finding('CONTRACT_INVALID', error.message));
  }
  const bundleVerification = verifyEvidenceBundle(evidence, task);
  findings.push(...bundleVerification.findings.map((item) => finding(item.code, 'evidence bundle validation failed', item)));
  if (!ledgerVerification?.valid) findings.push(finding('LEDGER_INVALID', 'ledger verification did not pass'));
  else if (evidence.ledger_head?.count !== ledgerVerification.count || evidence.ledger_head?.last_hash !== ledgerVerification.last_hash) {
    findings.push(finding('LEDGER_HEAD_MISMATCH', 'bundle ledger head differs from verified ledger'));
  }
  if (!gitState) findings.push(finding('GIT_MISSING', 'fresh Git state is required'));
  else {
    if (!gitState.clean) findings.push(finding('GIT_DIRTY', 'worktree must be clean'));
    if (evidence.git?.head !== evidence.final_commit || evidence.git?.clean !== true || evidence.git?.base_is_ancestor !== true) {
      findings.push(finding('BUNDLE_GIT_INVALID', 'bundle Git summary is incomplete or inconsistent'));
    }
    if (gitState.head !== evidence.final_commit) findings.push(finding('GIT_HEAD_MISMATCH', 'evidence is not bound to current HEAD'));
    if (JSON.stringify(gitState.changed_files) !== JSON.stringify([...evidence.changed_files].sort())) {
      findings.push(finding('GIT_CHANGED_FILES_MISMATCH', 'worker-reported changed files differ from fresh Git evidence'));
    }
  }
  if (!gitScope?.valid) findings.push(...(gitScope?.findings ?? [finding('GIT_SCOPE_MISSING', 'Git scope verification is required')]));
  if (!artifactVerification?.valid) findings.push(finding('ARTIFACT_MANIFEST_INVALID', 'artifact manifest verification failed'));
  for (const gate of evidence.gates) {
    if (!task.allowed_bash_commands.includes(gate.command) && !gate.command.startsWith('external:')) {
      findings.push(finding('GATE_COMMAND_NOT_ALLOWED', `gate command was not declared: ${gate.command}`, { command: gate.command }));
    }
  }
  const passedCommands = new Set(
    evidence.gates.filter((gate) => gate.status === 'PASS' && gate.exit_code === 0).map((gate) => gate.command),
  );
  for (const command of task.required_test_commands) {
    if (!passedCommands.has(command)) findings.push(finding('REQUIRED_TEST_MISSING', `required command did not pass: ${command}`, { command }));
  }
  const acceptance = new Map(evidence.acceptance.map((item) => [item.id, item]));
  for (const criterion of task.acceptance_criteria) {
    const result = acceptance.get(criterion.id);
    if (!result || result.status !== 'PASS' || typeof result.evidence !== 'string' || result.evidence.length === 0) {
      findings.push(finding('ACCEPTANCE_MISSING', `acceptance criterion did not pass: ${criterion.id}`, { id: criterion.id }));
    }
  }
  const risk = Number(task.risk.slice(1));
  if (risk >= 1 && !hasPassingReview(evidence, 'reviewer', task)) findings.push(finding('REVIEW_MISSING', 'fresh independent reviewer approval is required'));
  if (risk >= 2) {
    if (!hasPassingReview(evidence, 'security', task)) findings.push(finding('SECURITY_REVIEW_MISSING', 'fresh security approval is required'));
    const securityGate = evidence.gates.some((gate) => gate.category === 'security' && gate.status === 'PASS' && gate.exit_code === 0);
    if (!securityGate) findings.push(finding('SECURITY_GATE_MISSING', 'a deterministic security gate is required'));
    const integrationGate = evidence.gates.some((gate) => gate.category === 'integration' && gate.status === 'PASS' && gate.exit_code === 0);
    if (!integrationGate) findings.push(finding('INTEGRATION_GATE_MISSING', 'an integration gate is required'));
  }
  if (risk >= 3) {
    const approval = evidence.human_approval;
    if (approval?.status !== 'APPROVED' || approval.commit !== evidence.final_commit || typeof approval.approver !== 'string' || typeof approval.approved_at !== 'string') {
      findings.push(finding('HUMAN_APPROVAL_MISSING', 'R3 requires explicit approval bound to final_commit'));
    }
  }
  if (task.task_kind === 'bugfix') {
    const regression = evidence.gates.some((gate) => gate.category === 'regression' && gate.status === 'PASS' && gate.exit_code === 0);
    if (!regression) findings.push(finding('REGRESSION_TEST_MISSING', 'bug fixes require a passing regression test'));
  }
  for (const item of evidence.findings) {
    if ((SEVERITY_RANK[item.severity] ?? 99) >= SEVERITY_RANK.high && item.status !== 'RESOLVED') {
      findings.push(finding('LOAD_BEARING_FINDING_OPEN', `${item.severity} finding remains open`, { finding: item }));
    }
  }
  if (evidence.task_envelope_hash !== taskEnvelopeHash(task)) findings.push(finding('TASK_HASH_MISMATCH', 'task envelope hash mismatch'));
  return Object.freeze({
    verdict: findings.length === 0 ? 'PASS' : 'BLOCKED',
    task_id: task.task_id,
    task_envelope_hash: evidence.task_envelope_hash,
    final_commit: evidence.final_commit,
    bundle_hash: evidence.bundle_hash,
    findings,
    evaluated_at: new Date().toISOString(),
  });
}
