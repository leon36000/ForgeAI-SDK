import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/utils.mjs';
test('task schema exposes runtime bounds and writer identity',async()=>{const s=await readJson('schemas/task-envelope-v0.1.1.schema.json');assert.equal(s.properties.allowed_paths.maxItems,256);assert.equal(s.properties.allowed_bash_commands.items.maxLength,4096);assert.ok(s.allOf.some(rule=>rule.then?.properties?.metadata?.required?.includes('writer_session_id')));});
test('evidence schema requires review commit and hash',async()=>{const s=await readJson('schemas/evidence-bundle-v0.1.1.schema.json');const r=s.properties.reviews.items;assert.ok(r.required.includes('final_commit'));assert.ok(r.required.includes('evidence_hash'));assert.equal(s.properties.gates.maxItems,512);assert.equal(s.additionalProperties,false);});
