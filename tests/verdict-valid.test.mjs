import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from '../src/proof.mjs';
import { sampleEvidence, sampleTask, tempWorkspace } from './helpers.mjs';
const deps=(e)=>({ledgerVerification:{valid:true,count:e.ledger_head.count,last_hash:e.ledger_head.last_hash},gitState:{clean:true,head:e.final_commit,changed_files:[...e.changed_files].sort()},gitScope:{valid:true,findings:[]},artifactVerification:{valid:true}});
test('valid R1 evidence is accepted',async()=>{const w=await tempWorkspace();const t=sampleTask(w);const e=sampleEvidence(t);assert.equal(evaluateProof(t,e,deps(e)).verdict,'PASS');});
