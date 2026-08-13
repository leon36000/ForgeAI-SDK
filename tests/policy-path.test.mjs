import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkPath } from '../src/policy.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

test('writer may write in allowed path', async()=>{const w=await tempWorkspace();assert.equal(checkPath(sampleTask(w),'src/a.js',{write:true}).allowed,true);});
test('writer cannot write denied path', async()=>{const w=await tempWorkspace();await mkdir(join(w,'src','secrets'),{recursive:true});assert.equal(checkPath(sampleTask(w),'src/secrets/key.js',{write:true}).code,'PATH_DENIED');});
for(const path of ['.claude/agents/evil.md','.forgeai/policy.json','certs/server.key']) test(`protected path denied: ${path}`,async()=>{const w=await tempWorkspace();const t=sampleTask(w,{allowed_paths:['**']});assert.equal(checkPath(t,path,{write:true}).code,'PATH_DENIED');});
test('reviewer is read only', async()=>{const w=await tempWorkspace();const t=sampleTask(w,{role:'reviewer',mode:'REVIEW',execution:{qualified:true,sandbox_required:false,sandbox_verified:false}});assert.equal(checkPath(t,'src/a.js',{write:true}).code,'ROLE_READ_ONLY');});
test('path traversal is denied',async()=>{const w=await tempWorkspace();assert.equal(checkPath(sampleTask(w),'../escape.js',{write:true}).code,'PATH_INVALID');});
test('absolute outside path is denied',async()=>{const w=await tempWorkspace();assert.equal(checkPath(sampleTask(w),'/etc/passwd',{write:false}).code,'PATH_INVALID');});
test('control characters in path are denied',async()=>{const w=await tempWorkspace();assert.equal(checkPath(sampleTask(w),'src/a\n.js',{write:true}).code,'PATH_INVALID');});
test('escaping symlink is denied',async()=>{const w=await tempWorkspace();const o=await tempWorkspace('outside-');await symlink(o,join(w,'src','escape'));assert.equal(checkPath(sampleTask(w),'src/escape/file.js',{write:true}).code,'PATH_INVALID');});
test('write through internal symlink is denied',async()=>{const w=await tempWorkspace();await mkdir(join(w,'src','target'));await symlink(join(w,'src','target'),join(w,'src','link'));assert.equal(checkPath(sampleTask(w),'src/link/a.js',{write:true}).code,'PATH_INVALID');});
test('symlink to protected internal path is denied even for read',async()=>{const w=await tempWorkspace();await mkdir(join(w,'.claude','agents'),{recursive:true});await writeFile(join(w,'.claude','agents','x.md'),'x');await symlink(join(w,'.claude','agents'),join(w,'src','control'));assert.equal(checkPath(sampleTask(w),'src/control/x.md',{write:false}).code,'PATH_DENIED');});
test('inside symlink is allowed for read when target remains inside',async()=>{const w=await tempWorkspace();await mkdir(join(w,'src','target'));await writeFile(join(w,'src','target','a.js'),'x');await symlink(join(w,'src','target'),join(w,'src','link'));assert.equal(checkPath(sampleTask(w),'src/link/a.js',{write:false}).allowed,true);});
