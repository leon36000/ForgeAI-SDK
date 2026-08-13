import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';
const deps=(e)=>({ledgerVerification:{valid:true,count:e.ledger_head.count,last_hash:e.ledger_head.last_hash},gitState:{clean:true,head:e.final_commit,changed_files:[...e.changed_files].sort()},gitScope:{valid:true,findings:[]},artifactVerification:{valid:true}});
test('missing required command yields finding',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t,{gates:[{id:'only',category:'unit',command:'npm test',status:'PASS',exit_code:0}]});assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='REQUIRED_TEST_MISSING'));});
test('missing acceptance evidence yields finding',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t,{acceptance:[]});assert.ok(evaluateProof(t,e,deps(e)).findings.some((x)=>x.code==='ACCEPTANCE_MISSING'));});
