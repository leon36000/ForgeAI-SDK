import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';
const deps=(e)=>({ledgerVerification:{valid:true,count:e.ledger_head.count,last_hash:e.ledger_head.last_hash},gitState:{clean:true,head:e.final_commit,changed_files:[...e.changed_files].sort()},gitScope:{valid:true,findings:[]},artifactVerification:{valid:true}});
for(const [name,mutate,code] of [['dirty git',(d)=>{d.gitState.clean=false;},'GIT_DIRTY'],['head mismatch',(d)=>{d.gitState.head='f'.repeat(40);},'GIT_HEAD_MISMATCH'],['changed files',(d)=>{d.gitState.changed_files=['src/x.js'];},'GIT_CHANGED_FILES_MISMATCH'],['scope failure',(d)=>{d.gitScope={valid:false,findings:[{code:'GIT_OUT_OF_SCOPE',path:'x'}]};},'GIT_OUT_OF_SCOPE']])test(`proof blocks ${name}`,async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t);const d=deps(e);mutate(d);const r=evaluateProof(t,e,d);assert.equal(r.verdict,'BLOCKED');assert.ok(r.findings.some((x)=>x.code===code));});
