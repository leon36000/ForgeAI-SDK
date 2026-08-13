import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';
const deps=(e)=>({ledgerVerification:{valid:true,count:e.ledger_head.count,last_hash:e.ledger_head.last_hash},gitState:{clean:true,head:e.final_commit,changed_files:[...e.changed_files].sort()},gitScope:{valid:true,findings:[]},artifactVerification:{valid:true}});
test('valid R1 proof passes',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t);assert.equal(evaluateProof(t,e,deps(e)).verdict,'PASS');});
test('proof blocks missing ledger',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t);const d=deps(e);d.ledgerVerification={valid:false};const r=evaluateProof(t,e,d);assert.ok(r.findings.some((x)=>x.code==='LEDGER_INVALID'));});
test('proof blocks artifact failure',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t);const d=deps(e);d.artifactVerification={valid:false};const r=evaluateProof(t,e,d);assert.ok(r.findings.some((x)=>x.code==='ARTIFACT_MANIFEST_INVALID'));});
