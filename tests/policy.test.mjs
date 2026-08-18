import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCommand, checkNetwork, checkPath, checkToolUse } from '../src/policy.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

test('writer may write in allowed path', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkPath(sampleTask(workspace), 'src/a.js', { write: true }).allowed, true);
});
test('writer cannot write denied path', async () => {
  const workspace = await tempWorkspace(); await mkdir(join(workspace, 'src', 'secrets'), { recursive: true });
  assert.equal(checkPath(sampleTask(workspace), 'src/secrets/key.js', { write: true }).code, 'PATH_DENIED');
});
test('writer cannot write protected .claude agents', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { allowed_paths: ['**'] });
  assert.equal(checkPath(task, '.claude/agents/evil.md', { write: true }).code, 'PATH_DENIED');
});
test('writer cannot write protected Claude hooks', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { allowed_paths: ['**'] });
  assert.equal(checkPath(task, '.claude/hooks/forgeai-hook.mjs', { write: true }).code, 'PATH_DENIED');
});
test('writer cannot write .forgeai policy', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { allowed_paths: ['**'] });
  assert.equal(checkPath(task, '.forgeai/policy.json', { write: true }).code, 'PATH_DENIED');
});
test('writer cannot write secret key', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { allowed_paths: ['**'] });
  assert.equal(checkPath(task, 'certs/server.key', { write: true }).code, 'PATH_DENIED');
});
test('reviewer is read only', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { role: 'reviewer', mode: 'REVIEW', execution: { qualified: true, sandbox_required: false, sandbox_verified: false } });
  assert.equal(checkPath(task, 'src/a.js', { write: true }).code, 'ROLE_READ_ONLY');
});
test('path traversal is denied', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkPath(sampleTask(workspace), '../escape.js', { write: true }).code, 'PATH_INVALID');
});
test('absolute outside path is denied', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkPath(sampleTask(workspace), '/etc/passwd', { write: false }).code, 'PATH_INVALID');
});
test('control characters in path are denied', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkPath(sampleTask(workspace), 'src/a\n.js', { write: true }).code, 'PATH_INVALID');
});
test('escaping symlink is denied', async () => {
  const workspace = await tempWorkspace(); const outside = await tempWorkspace('outside-');
  await symlink(outside, join(workspace, 'src', 'escape'));
  assert.equal(checkPath(sampleTask(workspace), 'src/escape/file.js', { write: true }).code, 'PATH_INVALID');
});

test('write through internal symlink is denied', async () => {
  const workspace = await tempWorkspace(); await mkdir(join(workspace, 'src', 'target')); await symlink(join(workspace, 'src', 'target'), join(workspace, 'src', 'link'));
  assert.equal(checkPath(sampleTask(workspace), 'src/link/a.js', { write: true }).code, 'PATH_INVALID');
});
test('symlink to protected internal path is denied even for read', async () => {
  const workspace = await tempWorkspace(); await mkdir(join(workspace, '.claude', 'agents'), { recursive: true }); await writeFile(join(workspace, '.claude', 'agents', 'x.md'), 'x');
  await symlink(join(workspace, '.claude', 'agents'), join(workspace, 'src', 'control'));
  assert.equal(checkPath(sampleTask(workspace), 'src/control/x.md', { write: false }).code, 'PATH_DENIED');
});

test('inside symlink is allowed for read when target remains inside', async () => {
  const workspace = await tempWorkspace(); await mkdir(join(workspace, 'src', 'target')); await writeFile(join(workspace, 'src', 'target', 'a.js'), 'x');
  await symlink(join(workspace, 'src', 'target'), join(workspace, 'src', 'link'));
  assert.equal(checkPath(sampleTask(workspace), 'src/link/a.js', { write: false }).allowed, true);
});

test('exact allowed command passes', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkCommand(sampleTask(workspace), ' npm   test ').allowed, true);
});
test('undeclared command is denied', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkCommand(sampleTask(workspace), 'npm run build').code, 'COMMAND_NOT_DECLARED');
});
for (const command of ['sudo npm test', 'git reset --hard', 'git clean -fdx', 'rm -rf /']) {
  test(`destructive command denied: ${command}`, async () => {
    const workspace = await tempWorkspace();
    const task = sampleTask(workspace, { allowed_bash_commands: [...sampleTask(workspace).allowed_bash_commands, command] });
    assert.equal(checkCommand(task, command).code, 'COMMAND_DESTRUCTIVE');
  });
}
test('newline command injection is denied', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkCommand(sampleTask(workspace), 'npm test\nrm -rf /').code, 'COMMAND_INVALID');
});

test('exact network host allowed', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace, { allowed_network_hosts: ['api.example.com'] });
  assert.equal(checkNetwork(task, 'https://api.example.com/v1').allowed, true);
});
test('subdomain wildcard allowed but apex denied', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace, { allowed_network_hosts: ['*.example.com'] });
  assert.equal(checkNetwork(task, 'https://a.example.com').allowed, true);
  assert.equal(checkNetwork(task, 'https://example.com').allowed, false);
});
test('lookalike network host denied', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace, { allowed_network_hosts: ['example.com'] });
  assert.equal(checkNetwork(task, 'https://example.com.evil.test').code, 'NETWORK_DENIED');
});

test('tool router allows declared bash', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkToolUse(sampleTask(workspace), 'Bash', { command: 'npm test' }).allowed, true);
});
test('tool router denies unknown tools', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkToolUse(sampleTask(workspace), 'MagicTool', {}).code, 'TOOL_NOT_DECLARED');
});
test('tool router denies a missing tool name without throwing', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkToolUse(sampleTask(workspace), undefined, {}).code, 'TOOL_INVALID');
});
test('MCP is denied during execute', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkToolUse(sampleTask(workspace), 'mcp__litellm__consult', {}).code, 'MCP_EXECUTE_DENIED');
});
test('undeclared MCP consultation is denied', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { role: 'reviewer', mode: 'REVIEW', execution: { qualified: true, sandbox_required: false, sandbox_verified: false } });
  assert.equal(checkToolUse(task, 'mcp__other__write', {}).code, 'MCP_TOOL_NOT_DECLARED');
});

test('MCP consultation is allowed in review mode', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, { role: 'reviewer', mode: 'REVIEW', execution: { qualified: true, sandbox_required: false, sandbox_verified: false } });
  assert.equal(checkToolUse(task, 'mcp__litellm__consult', {}).allowed, true);
});

test('shell wrappers are denied even when allowlisted',async()=>{for(const command of ['bash -c "echo x"','sh -c "echo x"','pwsh -Command Get-ChildItem','cmd /c dir']){const w=await tempWorkspace();const t=sampleTask(w,{allowed_bash_commands:[...sampleTask(w).allowed_bash_commands,command]});assert.equal(checkCommand(t,command).code,'COMMAND_DESTRUCTIVE');}});
test('split git clean force options are denied',async()=>{const w=await tempWorkspace();const command='git clean -f -x';const t=sampleTask(w,{allowed_bash_commands:[...sampleTask(w).allowed_bash_commands,command]});assert.equal(checkCommand(t,command).code,'COMMAND_DESTRUCTIVE');});
test('recursive forced removal of workspace root is denied',async()=>{const w=await tempWorkspace();const command='rm -rf .';const t=sampleTask(w,{allowed_bash_commands:[...sampleTask(w).allowed_bash_commands,command]});assert.equal(checkCommand(t,command).code,'COMMAND_DESTRUCTIVE');});
test('recursive forced removal outside workspace is denied',async()=>{const w=await tempWorkspace();const command='rm -rf ../outside';const t=sampleTask(w,{allowed_bash_commands:[...sampleTask(w).allowed_bash_commands,command]});assert.equal(checkCommand(t,command).code,'COMMAND_DESTRUCTIVE');});
test('non HTTP network protocols are denied',async()=>{const w=await tempWorkspace();const t=sampleTask(w,{allowed_network_hosts:['example.com']});assert.equal(checkNetwork(t,'file:///etc/passwd').code,'NETWORK_PROTOCOL_DENIED');assert.equal(checkNetwork(t,'ftp://example.com/x').code,'NETWORK_PROTOCOL_DENIED');});
test('missing tool name fails closed without throwing',async()=>{const w=await tempWorkspace();assert.equal(checkToolUse(sampleTask(w),undefined,{}).code,'TOOL_INVALID');});


test('current Claude Code shell, web, monitor and LSP surfaces fail closed until modeled', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  for (const tool of ['PowerShell', 'WebSearch', 'Monitor', 'LSP', 'ReadMcpResourceTool', 'RemoteTrigger', 'TeamCreate']) {
    assert.equal(checkToolUse(task, tool, {}).allowed, false, `${tool} must fail closed`);
  }
});

test('session-control tools with no repository or network side effect remain available', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace);
  for (const tool of ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoWrite', 'ToolSearch']) {
    assert.equal(checkToolUse(task, tool, {}).allowed, true, `${tool} should remain available`);
  }
});

test('current read-only and session-control tools remain available without widening system side effects', async () => {
  const workspace=await tempWorkspace();
  try {
    for (const tool of ['ListAgents', 'ReportFindings', 'Skill', 'TaskOutput', 'TaskStop', 'WaitForMcpServers']) {
      const result=checkToolUse(sampleTask(workspace),tool,{});
      assert.equal(result.allowed,true,`${tool} should remain available as a bounded control/read-only tool`);
    }
  } finally { await rm(workspace,{recursive:true,force:true}); }
});

test('current tools with orchestration, publication, scheduling, worktree, or cross-session effects stay fail closed until modeled', async () => {
  const workspace=await tempWorkspace();
  try {
    for (const tool of ['Artifact','CronCreate','CronDelete','EnterWorktree','PushNotification','RemoteTrigger','ScheduleWakeup','SendMessage','SendUserFile','ShareOnboardingGuide','TeamCreate','TeamDelete','Workflow']) {
      const result=checkToolUse(sampleTask(workspace),tool,{});
      assert.equal(result.allowed,false,`${tool} must remain fail closed`);
      assert.equal(result.code,'TOOL_NOT_DECLARED');
    }
  } finally { await rm(workspace,{recursive:true,force:true}); }
});

test('writer cannot delegate through Agent', async () => {
  const workspace = await tempWorkspace();
  assert.equal(checkToolUse(sampleTask(workspace), 'Agent', { prompt: 'inspect', subagent_type: 'Explore' }).code, 'ROLE_DELEGATION_DENIED');
});

test('main-thread orchestrator may dispatch a read-only Agent', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, {
    role: 'orchestrator',
    mode: 'CONSULT',
    execution: { qualified: true, sandbox_required: false, sandbox_verified: false },
    delegation: { agent_depth: 0, max_parallel_agents: 4, allow_nested_agents: false },
  });
  assert.equal(checkToolUse(task, 'Agent', { prompt: 'inspect', subagent_type: 'Explore' }, { agent_id: null, permission_mode: 'default' }).allowed, true);
});

test('subagent cannot recursively dispatch Agent', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, {
    role: 'orchestrator',
    mode: 'CONSULT',
    execution: { qualified: true, sandbox_required: false, sandbox_verified: false },
    delegation: { agent_depth: 0, max_parallel_agents: 4, allow_nested_agents: false },
  });
  assert.equal(checkToolUse(task, 'Agent', { prompt: 'nested', subagent_type: 'Explore' }, { agent_id: 'agent-child', permission_mode: 'default' }).code, 'NESTED_AGENT_DENIED');
});

test('orchestrator delegation is denied while Claude permissions are bypassed', async () => {
  const workspace = await tempWorkspace();
  const task = sampleTask(workspace, {
    role: 'orchestrator',
    mode: 'CONSULT',
    execution: { qualified: true, sandbox_required: false, sandbox_verified: false },
    delegation: { agent_depth: 0, max_parallel_agents: 4, allow_nested_agents: false },
  });
  assert.equal(checkToolUse(task, 'Agent', { prompt: 'inspect', subagent_type: 'Explore' }, { permission_mode: 'bypassPermissions' }).code, 'PERMISSION_BYPASS_DENIED');
});
