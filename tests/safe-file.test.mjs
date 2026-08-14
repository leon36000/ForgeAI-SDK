import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readStableRegularFile, SAFE_FILE_CAPABILITIES } from '../src/safe-file.mjs';
import { tempWorkspace } from './helpers.mjs';

test('safe-file capability is explicit', () => assert.equal(typeof SAFE_FILE_CAPABILITIES.secure_no_follow, 'boolean'));
test('stable file reader returns bytes and metadata', async () => { const w=await tempWorkspace('safe-file-'); const p=join(w,'x'); await writeFile(p,'stable'); const r=await readStableRegularFile(p); assert.equal(r.bytes.toString(),'stable'); assert.equal(r.size,6); });
test('stable file reader enforces byte limit', async () => { const w=await tempWorkspace('safe-file-'); const p=join(w,'x'); await writeFile(p,'12345'); await assert.rejects(()=>readStableRegularFile(p,{maxBytes:4}),/maximum size/u); });
test('stable file reader rejects symbolic link', async () => { const w=await tempWorkspace('safe-file-'); const t=join(w,'t'); const l=join(w,'l'); await writeFile(t,'x'); await symlink(t,l); await assert.rejects(()=>readStableRegularFile(l),/symbolic link/u); });
test('stable file reader rejects path swapped to symlink before open', async () => { const w=await tempWorkspace('safe-file-'); const p=join(w,'p'); const t=join(w,'t'); await writeFile(p,'a'); await writeFile(t,'b'); await assert.rejects(()=>readStableRegularFile(p,{_beforeOpen:async()=>{await rm(p);await symlink(t,p);}}),/symbolic link/u); });
test('stable file reader rejects mutation while open handle is read', async () => { const w=await tempWorkspace('safe-file-'); const p=join(w,'p'); await writeFile(p,'original'); await assert.rejects(()=>readStableRegularFile(p,{_beforeRead:async()=>writeFile(p,'mutated-content')}),/changed during secure read/u); });

test('stable file reader rejects path replacement while the original descriptor remains open', async () => {
  const w=await tempWorkspace('safe-file-');
  const p=join(w,'subject');
  const replacement=join(w,'replacement');
  await writeFile(p,'original');
  await writeFile(replacement,'replacement');
  await assert.rejects(
    ()=>readStableRegularFile(p,{_beforeRead:async()=>rename(replacement,p)}),
    /changed during secure read/u,
  );
});
