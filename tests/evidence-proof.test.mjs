import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildArtifactManifest, verifyArtifactManifest, verifyEvidenceBundle } from '../src/evidence.mjs';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';

const deps = (evidence) => ({
  ledgerVerification: { valid: true, count: evidence.ledger_head.count, last_hash: evidence.ledger_head.last_hash },
  gitState: { clean: true, head: evidence.final_commit, changed_files: [...evidence.changed_files].sort() },
  gitScope: { valid: true, findings: [] },
  artifactVerification: { valid: true },
});

test('seals and verifies evidence bundle', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = sampleEvidence(task);
  assert.equal(verifyEvidenceBundle(evidence, task).valid, true);
});
test('detects evidence tampering', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = structuredClone(sampleEvidence(task)); evidence.changed_files.push('src/evil.js');
  assert.equal(verifyEvidenceBundle(evidence, task).valid, false);
});
test('detects task hash mismatch', async () => {
  const workspace = await tempWorkspace(); const task = sampleTask(workspace); const evidence = sampleEvidence(task); const changed = sampleTask(workspace,{title:'changed'});
  assert.equal(verifyEvidenceBundle(evidence, changed).valid, false);
});
test('artifact manifest is stable and verified', async () => {
  const dir = await tempWorkspace('artifacts-'); await writeFile(join(dir,'a.txt'),'a'); await mkdir(join(dir,'nested')); await writeFile(join(dir,'nested','b.txt'),'bb');
  const manifest=await buildArtifactManifest(dir); assert.deepEqual(manifest.map((item)=>item.path),['a.txt','nested/b.txt']); assert.equal((await verifyArtifactManifest(dir,manifest)).valid,true);
});
test('artifact manifest detects changed bytes', async () => {
  const dir = await tempWorkspace('artifacts-'); await writeFile(join(dir,'a.txt'),'a'); const manifest=await buildArtifactManifest(dir); await writeFile(join(dir,'a.txt'),'b'); assert.equal((await verifyArtifactManifest(dir,manifest)).valid,false);
});
test('artifact manifest rejects symlinks', async () => {
  const dir=await tempWorkspace('artifacts-'); const outside=await tempWorkspace('outside-'); await writeFile(join(outside,'a'),'x'); await symlink(join(outside,'a'),join(dir,'link')); await assert.rejects(()=>buildArtifactManifest(dir),/symbolic link|symlink/u);
});

test('valid R1 proof passes', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task); assert.equal(evaluateProof(task,evidence,deps(evidence)).verdict,'PASS');
});
for (const [name, mutate, code] of [
  ['missing ledger', (d)=>{d.ledgerVerification={valid:false};}, 'LEDGER_INVALID'],
  ['dirty git', (d)=>{d.gitState.clean=false;}, 'GIT_DIRTY'],
  ['head mismatch', (d)=>{d.gitState.head='f'.repeat(40);}, 'GIT_HEAD_MISMATCH'],
  ['changed file mismatch', (d)=>{d.gitState.changed_files=['src/x.js'];}, 'GIT_CHANGED_FILES_MISMATCH'],
  ['scope failure', (d)=>{d.gitScope={valid:false,findings:[{code:'GIT_OUT_OF_SCOPE',path:'x'}]};}, 'GIT_OUT_OF_SCOPE'],
  ['artifact failure', (d)=>{d.artifactVerification={valid:false};}, 'ARTIFACT_MANIFEST_INVALID'],
]) test(`proof blocks ${name}`, async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task); const d=deps(evidence); mutate(d); const result=evaluateProof(task,evidence,d); assert.equal(result.verdict,'BLOCKED'); assert.ok(result.findings.some((item)=>item.code===code));
});
test('proof blocks missing required command', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{gates:[{id:'only',category:'unit',command:'npm test',status:'PASS',exit_code:0}]}); const result=evaluateProof(task,evidence,deps(evidence)); assert.ok(result.findings.some((item)=>item.code==='REQUIRED_TEST_MISSING'));
});
test('proof blocks missing acceptance evidence', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{acceptance:[]}); const result=evaluateProof(task,evidence,deps(evidence)); assert.ok(result.findings.some((item)=>item.code==='ACCEPTANCE_MISSING'));
});
test('R1 requires fresh reviewer', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{reviews:[]}); const result=evaluateProof(task,evidence,deps(evidence)); assert.ok(result.findings.some((item)=>item.code==='REVIEW_MISSING'));
});
test('self-context reviewer does not count', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{reviews:[{role:'reviewer',model:'x',session_id:'same-session',verdict:'PASS',context_fresh:false,findings_count:0,evidence_hash:'c'.repeat(64),final_commit:task.base_commit}]}); const result=evaluateProof(task,evidence,deps(evidence)); assert.ok(result.findings.some((item)=>item.code==='REVIEW_MISSING'));
});
test('fresh reviewer may use the same model as the writer', async () => {
  const workspace=await tempWorkspace();
  const task=sampleTask(workspace);
  const evidence=sampleEvidence(task,{reviews:[{
    role:'reviewer',
    model:task.metadata.writer_model,
    session_id:'fresh-reviewer-session',
    verdict:'PASS',
    context_fresh:true,
    findings_count:0,
    evidence_hash:'c'.repeat(64),
    final_commit:task.base_commit,
  }]});
  assert.equal(evaluateProof(task,evidence,deps(evidence)).verdict,'PASS');
});
test('R2 requires security and integration gates', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace,{risk:'R2'}); const evidence=sampleEvidence(task); const codes=evaluateProof(task,evidence,deps(evidence)).findings.map((item)=>item.code); assert.ok(codes.includes('SECURITY_REVIEW_MISSING')); assert.ok(codes.includes('SECURITY_GATE_MISSING')); assert.ok(codes.includes('INTEGRATION_GATE_MISSING'));
});
test('R2 passes with security controls', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace,{risk:'R2'}); const base=sampleEvidence(task); const evidence=sampleEvidence(task,{gates:[...base.gates,{id:'sec',category:'security',command:'external:sonar',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)},{id:'int',category:'integration',command:'external:integration',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)}],reviews:[...base.reviews,{role:'security',model:'sec-model',session_id:'security-session',verdict:'PASS',context_fresh:true,findings_count:0,evidence_hash:'c'.repeat(64),final_commit:task.base_commit}]}); assert.equal(evaluateProof(task,evidence,deps(evidence)).verdict,'PASS');
});
test('R3 requires human approval', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace,{risk:'R3'}); const base=sampleEvidence(task); const evidence=sampleEvidence(task,{gates:[...base.gates,{id:'sec',category:'security',command:'external:sonar',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)},{id:'int',category:'integration',command:'external:integration',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)}],reviews:[...base.reviews,{role:'security',model:'sec',session_id:'security-session',verdict:'PASS',context_fresh:true,findings_count:0,evidence_hash:'c'.repeat(64),final_commit:task.base_commit}]}); assert.ok(evaluateProof(task,evidence,deps(evidence)).findings.some((item)=>item.code==='HUMAN_APPROVAL_MISSING'));
});
test('bugfix requires regression test', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace,{task_kind:'bugfix'}); const evidence=sampleEvidence(task); assert.ok(evaluateProof(task,evidence,deps(evidence)).findings.some((item)=>item.code==='REGRESSION_TEST_MISSING'));
});
test('unresolved high finding blocks', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{findings:[{severity:'high',status:'OPEN',code:'X'}]}); assert.ok(evaluateProof(task,evidence,deps(evidence)).findings.some((item)=>item.code==='LOAD_BEARING_FINDING_OPEN'));
});
test('resolved critical finding does not block', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); const evidence=sampleEvidence(task,{findings:[{severity:'critical',status:'RESOLVED',code:'X'}]}); assert.equal(evaluateProof(task,evidence,deps(evidence)).verdict,'PASS');
});

test('stale review commit blocks',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const b=sampleEvidence(t);const e=sampleEvidence(t,{reviews:b.reviews.map(r=>({...r,final_commit:'f'.repeat(40)}))});assert.equal(evaluateProof(t,e,deps(e)).verdict,'BLOCKED');});
test('review without evidence hash blocks',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const b=sampleEvidence(t);const review={...b.reviews[0]};delete review.evidence_hash;const e=sampleEvidence(t,{reviews:[review]});assert.equal(evaluateProof(t,e,deps(e)).verdict,'BLOCKED');});
test('bundle rejects nested extra review fields',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const b=sampleEvidence(t);const e=sampleEvidence(t,{reviews:[{...b.reviews[0],surprise:true}]});assert.equal(verifyEvidenceBundle(e,t).valid,false);});
test('bundle gates are bounded',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const gate={id:'x',category:'unit',command:'npm test',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)};const e=sampleEvidence(t,{gates:Array.from({length:513},(_,i)=>({...gate,id:`g${i}`}))});assert.equal(verifyEvidenceBundle(e,t).valid,false);});
test('malformed proof fails closed rather than throwing',async()=>{const w=await tempWorkspace();const t=sampleTask(w);assert.equal(evaluateProof(t,{schema_version:'x'},{}).verdict,'BLOCKED');});
test('proof accepts semantically equivalent gate command',async()=>{const w=await tempWorkspace();const t=sampleTask(w,{allowed_bash_commands:['npm   test','npm run lint'],required_test_commands:['npm test','npm run lint']});const e=sampleEvidence(t,{gates:[{id:'a',category:'unit',command:'npm test',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)},{id:'b',category:'unit',command:'npm run lint',status:'PASS',exit_code:0,duration_ms:1,stdout_sha256:'a'.repeat(64),stderr_sha256:'b'.repeat(64)}]});assert.equal(evaluateProof(t,e,deps(e)).verdict,'PASS');});
