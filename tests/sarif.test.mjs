import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempWorkspace } from './helpers.mjs';
const checker=new URL('../scripts/check-sarif.mjs',import.meta.url).pathname;
function run(dir){return spawnSync(process.execPath,[checker,dir],{encoding:'utf8'});}
test('SARIF gate passes zero results',async()=>{const w=await tempWorkspace('sarif-');const d=join(w,'out');await mkdir(d);await writeFile(join(d,'r.sarif'),JSON.stringify({version:'2.1.0',runs:[{results:[]}]}));assert.equal(run(d).status,0);});
test('SARIF gate blocks findings',async()=>{const w=await tempWorkspace('sarif-');const d=join(w,'out');await mkdir(d);await writeFile(join(d,'r.sarif'),JSON.stringify({version:'2.1.0',runs:[{results:[{ruleId:'x'}]}]}));assert.equal(run(d).status,2);});
test('SARIF gate rejects missing reports',async()=>{const w=await tempWorkspace('sarif-');assert.notEqual(run(w).status,0);});
test('SARIF gate rejects symlinked reports',async()=>{const w=await tempWorkspace('sarif-');const d=join(w,'out');await mkdir(d);const outside=join(w,'outside.sarif');await writeFile(outside,JSON.stringify({version:'2.1.0',runs:[{results:[]}]}));await symlink(outside,join(d,'r.sarif'));assert.notEqual(run(d).status,0);});
