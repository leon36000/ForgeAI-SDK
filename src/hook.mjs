import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkToolUse } from './policy.mjs';
import { appendLedgerEvent, verifyLedger } from './ledger.mjs';
import { taskEnvelopeHash } from './contracts.mjs';
import { inspectGitState } from './git-proof.mjs';
import { readJson } from './utils.mjs';

async function loadTask(event) {
  const path = process.env.FORGEAI_TASK_ENVELOPE ?? event.task_envelope_path ?? '.forgeai/current-task.json';
  return readJson(resolve(path));
}

export async function handleHook(eventName, event) {
  if (eventName === 'PreToolUse') {
    const task = await loadTask(event);
    const toolName = event.tool_name ?? event.toolName;
    const input = event.tool_input ?? event.toolInput ?? {};
    const result = checkToolUse(task, toolName, input);
    return {
      allow: result.allowed,
      exitCode: result.allowed ? 0 : 2,
      stdout: JSON.stringify({
        decision: result.allowed ? 'allow' : 'block',
        reason: result.reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: result.allowed ? 'allow' : 'deny',
          permissionDecisionReason: result.reason,
        },
      }),
      stderr: result.allowed ? '' : result.reason,
    };
  }
  if (['TaskCompleted', 'SubagentStop', 'Stop'].includes(eventName)) {
    const proofPath = process.env.FORGEAI_PROOF_RESULT ?? '.forgeai/runtime/latest-proof.json';
    let proof;
    let task;
    try {
      task = await loadTask(event);
      proof = JSON.parse(await readFile(resolve(proofPath), 'utf8'));
    } catch {
      return { allow: false, exitCode: 2, stdout: '', stderr: `${eventName} blocked: task or verified PROOF result is missing` };
    }
    if (proof.verdict !== 'PASS' || proof.task_id !== task.task_id || proof.task_envelope_hash !== taskEnvelopeHash(task)) {
      return { allow: false, exitCode: 2, stdout: '', stderr: `${eventName} blocked: PROOF is absent, blocked, stale or bound to another task` };
    }
    try {
      const git = inspectGitState(task.workspace, task.base_commit, proof.final_commit);
      if (git.head !== proof.final_commit || !git.clean) throw new Error('Git state changed after proof');
    } catch (error) {
      return { allow: false, exitCode: 2, stdout: '', stderr: `${eventName} blocked: ${error.message}` };
    }
    return { allow: true, exitCode: 0, stdout: '', stderr: '' };
  }
  if (['PreCompact', 'PostToolUse', 'PostCompact', 'WorktreeCreate', 'WorktreeRemove', 'SessionStart'].includes(eventName)) {
    const ledgerDir = process.env.FORGEAI_LEDGER_DIR;
    if (ledgerDir) {
      try {
        if (eventName === 'SessionStart') await verifyLedger(resolve(ledgerDir));
        const task = await loadTask(event);
        await appendLedgerEvent(resolve(ledgerDir), {
          type: `HOOK_${eventName.toUpperCase()}`,
          actor: event.agent_id ?? event.session_id ?? 'claude-code',
          task_id: task.task_id,
          payload: { event_name: eventName, tool_name: event.tool_name ?? null },
        });
        if (eventName === 'PreCompact') {
          const snapshot = resolve(task.workspace, '.forgeai', 'runtime', 'compact-snapshot.json');
          await mkdir(resolve(task.workspace, '.forgeai', 'runtime'), { recursive: true });
          await writeFile(snapshot, `${JSON.stringify({ task_id: task.task_id, task_hash: taskEnvelopeHash(task), captured_at: new Date().toISOString() })}\n`, { encoding: 'utf8', mode: 0o600 });
        }
      } catch (error) {
        return { allow: false, exitCode: 2, stdout: '', stderr: `${eventName} blocked: ledger lifecycle failure: ${error.message}` };
      }
    }
    return { allow: true, exitCode: 0, stdout: '', stderr: '' };
  }
  return { allow: false, exitCode: 2, stdout: '', stderr: `unsupported hook event: ${eventName}` };
}
