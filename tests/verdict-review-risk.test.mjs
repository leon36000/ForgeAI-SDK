import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';
const deps=(e)=>({ledgerVerification:{valid:true,count:e.ledger_head.count,last_hash:e.ledger_head.last_hash},gitState:{clean:true,head:e.final_commit,changed_files:[...e.changed_files].sort()},gitScope:{valid:true,findings:[]},artifactVerification:{valid:true}});

test('R1 requires fresh reviewer', async () => {
  const w=await tempWorkspace(); const t=sampleTask(w); const e=sampleEvidence(t,{reviews:[]}); assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='REVIEW_MISSING'));
});
test('self-context reviewer does not count', async () => {
  const w=await tempWorkspace(); const t=sampleTask(w); const e=sampleEvidence(t,{reviews:[{role:'reviewer',model:'x',session_id:'same-session',verdict:'PASS',context_fresh:false}]}); assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='REVIEW_MISSING'));
});
test('R2 requires security and integration gates', async () => {
  const w=await tempWorkspace(); const t=sampleTask(w,{risk:'R2'}); const e=sampleEvidence(t); const codes=evaluateProof(t,e,deps(e)).findings.map((x)=>x.code); assert.ok(codes.includes('SECURITY_REVIEW_MISSING')); assert.ok(codes.includes('SECURITY_GATE_MISSING')); assert.ok(codes.includes('INTEGRATION_GATE_MISSING'));
});
function secured(task){const b=sampleEvidence(task);return sampleEvidence(task,{gates:[...b.gates,{id:'sec',category:'security',command:'external:sonar',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)},{id:'int',category:'integration',command:'external:integration',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)}],reviews:[...b.reviews,{role:'security',model:'sec-model',session_id:'security-session',verdict:'PASS',context_fresh:true}]});}
test('R2 passes with security controls', async () => {const w=await tempWorkspace();const t=sampleTask(w,{risk:'R2'});const e=secured(t);assert.equal(evaluateProof(t,e,deps(e)).verdict,'PASS');});
test('R3 requires human approval', async () => {const w=await tempWorkspace();const t=sampleTask(w,{risk:'R3'});const e=secured(t);assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='HUMAN_APPROVAL_MISSING'));});
test('bugfix requires regression test', async () => {const w=await tempWorkspace();const t=sampleTask(w,{task_kind:'bugfix'});const e=sampleEvidence(t);assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='REGRESSION_TEST_MISSING'));});
test('unresolved high finding blocks', async () => {const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t,{findings:[{severity:'high',status:'OPEN',code:'X'}]});assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='LOAD_BEARING_FINDING_OPEN'));});
test('resolved critical finding does not block', async () => {const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t,{findings:[{severity:'critical',status:'RESOLVED',code:'X'}]});assert.equal(evaluateProof(t,e,deps(e)).verdict,'PASS');});
