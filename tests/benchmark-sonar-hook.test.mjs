import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBenchmarkSlots, computeBenchmarkMetrics } from '../src/benchmark.mjs';
import { parseReportTask, waitForSonarQualityGate } from '../src/sonar.mjs';
import { handleHook } from '../src/hook.mjs';
import { initGitRepo, sampleTask, tempWorkspace } from './helpers.mjs';
import { taskEnvelopeHash } from '../src/contracts.mjs';

test('benchmark creates exactly 15 unassigned slots', () => {
  const slots=createBenchmarkSlots(); assert.equal(slots.length,15); assert.equal(new Set(slots.map((item)=>item.slot_id)).size,15); assert.ok(slots.every((item)=>item.status==='UNASSIGNED'));
});
test('benchmark metrics calculate verified success and false done', () => {
  const result=computeBenchmarkMetrics([{verdict:'PASS',claimed_done:true,cost_usd:1,duration_ms:100,rework_rounds:0,escaped_defects:0},{verdict:'BLOCKED',claimed_done:true,cost_usd:3,duration_ms:300,rework_rounds:2,escaped_defects:1}]); assert.equal(result.verified_success_rate,0.5); assert.equal(result.false_done_rate,0.5); assert.equal(result.cost_per_verified_success_usd,4); assert.equal(result.median_duration_ms,200);
});
test('benchmark rejects empty runs', () => assert.throws(()=>computeBenchmarkMetrics([]),/at least one/u));

test('parses Sonar report task', () => assert.deepEqual(parseReportTask('projectKey=p\nserverUrl=https://sonar.example\nceTaskUrl=https://sonar.example/api/ce/task?id=1\n').projectKey,'p'));
test('rejects incomplete Sonar report task', () => assert.throws(()=>parseReportTask('projectKey=p\n'),/incomplete/u));
test('Sonar quality gate passes after CE success', async () => {
  const workspace=await tempWorkspace(); const report=join(workspace,'report-task.txt'); await writeFile(report,'projectKey=p\nserverUrl=https://sonar.example\nceTaskUrl=https://sonar.example/api/ce/task?id=1\n'); let calls=0;
  const fetchImpl=async (url)=>{calls+=1; if(String(url).includes('/api/ce/task')) return {ok:true,status:200,json:async()=>({task:{status:'SUCCESS',analysisId:'a1'}})}; return {ok:true,status:200,json:async()=>({projectStatus:{status:'OK'}})};};
  const result=await waitForSonarQualityGate({reportPath:report,token:'t',fetchImpl,pollMs:0}); assert.equal(result.status,'PASS'); assert.equal(calls,2);
});
test('Sonar quality gate fails closed on ERROR', async () => {
  const workspace=await tempWorkspace(); const report=join(workspace,'report-task.txt'); await writeFile(report,'projectKey=p\nserverUrl=https://sonar.example\nceTaskUrl=https://sonar.example/api/ce/task?id=1\n'); const fetchImpl=async (url)=>String(url).includes('/api/ce/task')?{ok:true,status:200,json:async()=>({task:{status:'SUCCESS',analysisId:'a1'}})}:{ok:true,status:200,json:async()=>({projectStatus:{status:'ERROR'}})}; await assert.rejects(()=>waitForSonarQualityGate({reportPath:report,token:'t',fetchImpl,pollMs:0}),/quality gate is ERROR/u);
});
test('Sonar requires token', async () => await assert.rejects(()=>waitForSonarQualityGate({reportPath:'x',token:''}),/required/u));

test('PreToolUse hook allows declared command', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const taskPath=join(workspace,'task.json'); await writeFile(taskPath,JSON.stringify(task)); const previous=process.env.FORGEAI_TASK_ENVELOPE; process.env.FORGEAI_TASK_ENVELOPE=taskPath; try { const result=await handleHook('PreToolUse',{tool_name:'Bash',tool_input:{command:'npm test'}}); assert.equal(result.allow,true); } finally { if(previous===undefined) delete process.env.FORGEAI_TASK_ENVELOPE; else process.env.FORGEAI_TASK_ENVELOPE=previous; }
});
test('PreToolUse hook blocks undeclared command with exit 2', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const taskPath=join(workspace,'task.json'); await writeFile(taskPath,JSON.stringify(task)); const previous=process.env.FORGEAI_TASK_ENVELOPE; process.env.FORGEAI_TASK_ENVELOPE=taskPath; try { const result=await handleHook('PreToolUse',{tool_name:'Bash',tool_input:{command:'npm run evil'}}); assert.equal(result.allow,false); assert.equal(result.exitCode,2); } finally { if(previous===undefined) delete process.env.FORGEAI_TASK_ENVELOPE; else process.env.FORGEAI_TASK_ENVELOPE=previous; }
});
test('TaskCompleted blocks without proof', async () => {
  const workspace=await tempWorkspace(); const previous=process.env.FORGEAI_PROOF_RESULT; process.env.FORGEAI_PROOF_RESULT=join(workspace,'missing.json'); try { const result=await handleHook('TaskCompleted',{}); assert.equal(result.allow,false); assert.equal(result.exitCode,2); } finally { if(previous===undefined) delete process.env.FORGEAI_PROOF_RESULT; else process.env.FORGEAI_PROOF_RESULT=previous; }
});
test('TaskCompleted allows only a PASS proof bound to current task and HEAD', async () => {
  const workspace=await tempWorkspace(); const base=await initGitRepo(workspace); const task=sampleTask(workspace,{base_commit:base}); await mkdir(join(workspace,'.forgeai','runtime'),{recursive:true}); const taskPath=join(workspace,'.forgeai','runtime','task.json'); await writeFile(taskPath,JSON.stringify(task)); const proofPath=join(workspace,'.forgeai','runtime','proof.json'); await writeFile(proofPath,JSON.stringify({verdict:'PASS',task_id:task.task_id,task_envelope_hash:taskEnvelopeHash(task),final_commit:base,bundle_hash:'a'.repeat(64)}));
  const previousProof=process.env.FORGEAI_PROOF_RESULT; const previousTask=process.env.FORGEAI_TASK_ENVELOPE; process.env.FORGEAI_PROOF_RESULT=proofPath; process.env.FORGEAI_TASK_ENVELOPE=taskPath;
  try { assert.equal((await handleHook('TaskCompleted',{})).allow,true); } finally { if(previousProof===undefined) delete process.env.FORGEAI_PROOF_RESULT; else process.env.FORGEAI_PROOF_RESULT=previousProof; if(previousTask===undefined) delete process.env.FORGEAI_TASK_ENVELOPE; else process.env.FORGEAI_TASK_ENVELOPE=previousTask; }
});
test('TaskCompleted blocks stale proof after HEAD changes', async () => {
  const workspace=await tempWorkspace(); const base=await initGitRepo(workspace); const task=sampleTask(workspace,{base_commit:base}); await mkdir(join(workspace,'.forgeai','runtime'),{recursive:true}); const taskPath=join(workspace,'.forgeai','runtime','task.json'); await writeFile(taskPath,JSON.stringify(task)); const proofPath=join(workspace,'.forgeai','runtime','proof.json'); await writeFile(proofPath,JSON.stringify({verdict:'PASS',task_id:task.task_id,task_envelope_hash:taskEnvelopeHash(task),final_commit:base,bundle_hash:'a'.repeat(64)})); await writeFile(join(workspace,'src','index.js'),'changed');
  const previousProof=process.env.FORGEAI_PROOF_RESULT; const previousTask=process.env.FORGEAI_TASK_ENVELOPE; process.env.FORGEAI_PROOF_RESULT=proofPath; process.env.FORGEAI_TASK_ENVELOPE=taskPath;
  try { assert.equal((await handleHook('TaskCompleted',{})).allow,false); } finally { if(previousProof===undefined) delete process.env.FORGEAI_PROOF_RESULT; else process.env.FORGEAI_PROOF_RESULT=previousProof; if(previousTask===undefined) delete process.env.FORGEAI_TASK_ENVELOPE; else process.env.FORGEAI_TASK_ENVELOPE=previousTask; }
});
test('unknown hook event fails closed', async () => assert.equal((await handleHook('Unknown',{})).allow,false));
