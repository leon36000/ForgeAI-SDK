export const CONTROL_PLANE_POLICY_SCHEMA_VERSION = 'forgeai.control-plane-policy.v0.2.0-alpha.1';
export const WRITER_RESULT_SCHEMA_VERSION = 'forgeai.writer-result.v0.2.0-alpha.1';
export const REVIEWER_RESULT_SCHEMA_VERSION = 'forgeai.reviewer-result.v0.2.0-alpha.1';
export const CONTROL_PLANE_RESULT_SCHEMA_VERSION = 'forgeai.control-plane-result.v0.2.0-alpha.1';

export const SUPPORTED_CLAUDE_AGENT_SDK = Object.freeze({
  package: '@anthropic-ai/claude-agent-sdk',
  version: '0.3.232',
});

export const CONTROL_PLANE_LIMITS = Object.freeze({
  max_turns: 128,
  max_role_budget_usd: 100,
  max_total_budget_usd: 200,
  max_findings: 64,
  max_summary_chars: 16_384,
  max_evidence_chars: 16_384,
  max_message_chars: 8_192,
});

export const WRITER_TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']);
export const REVIEWER_TOOLS = Object.freeze(['Read', 'Glob', 'Grep']);
export const CONTROL_PLANE_DENIED_TOOLS = Object.freeze([
  'Agent', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'SendMessage',
  'WebFetch', 'WebSearch', 'NotebookEdit', 'MultiEdit',
]);
