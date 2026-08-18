import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectRegularFiles } from '../src/file-tree.mjs';
import { tempWorkspace } from './helpers.mjs';

test('file tree returns sorted regular files', async()=>{const w=await tempWorkspace('tree-');await writeFile(join(w,'src','b.js'),'b');await writeFile(join(w,'src','a.js'),'a');const f=await collectRegularFiles(w);assert.deepEqual(f.map(x=>x.relative),['src/a.js','src/b.js']);});
test('file tree rejects symlinks',async()=>{const w=await tempWorkspace('tree-');const o=await tempWorkspace('tree-o-');await writeFile(join(o,'x'),'x');await symlink(join(o,'x'),join(w,'src','link'));await assert.rejects(()=>collectRegularFiles(w),/symbolic link/u);});
test('file tree detects mutation during enumeration',async()=>{const w=await tempWorkspace('tree-');await writeFile(join(w,'src','a.js'),'a');let once=false;await assert.rejects(()=>collectRegularFiles(w,{_afterReadDirectory:async c=>{if(!once&&c===w){once=true;await writeFile(join(w,'late.js'),'late');}}}),/changed during enumeration/u);});
test('file tree enforces inventory bound',async()=>{const w=await tempWorkspace('tree-');await writeFile(join(w,'src','a.js'),'a');await writeFile(join(w,'src','b.js'),'b');await assert.rejects(()=>collectRegularFiles(w,{maxFiles:1}),/maximum 1/u);});
