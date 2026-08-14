import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeclaredGate, runRequiredGates } from '../src/gate-runner.mjs';
import { scanSecrets } from '../src/secret-scan.mjs';
import { sampleTask, tempWorkspace } from './helpers.mjs';

test('gate runner executes an exact declared command and hashes logs', async () => {
  const workspace=await tempWorkspace(); const command=`${process.execPath} -e "process.stdout.write('ok')"`; const task=sampleTask(workspace,{allowed_bash_commands:[command],required_test_commands:[command]}); const result=await runDeclaredGate(task,{id:'node-ok',category:'unit',command}); assert.equal(result.status,'PASS'); assert.equal(result.exit_code,0); assert.match(result.stdout_sha256,/^[0-9a-f]{64}$/u); assert.equal(await readFile(result.stdout_path,'utf8'),'ok');
});
test('gate runner records failing command', async () => {
  const workspace=await tempWorkspace(); const command=`${process.execPath} -e "process.exit(7)"`; const task=sampleTask(workspace,{allowed_bash_commands:[command],required_test_commands:[command]}); const result=await runDeclaredGate(task,{id:'node-fail',category:'unit',command}); assert.equal(result.status,'FAIL'); assert.equal(result.exit_code,7);
});
test('gate runner rejects undeclared command', async () => {
  const workspace=await tempWorkspace(); const task=sampleTask(workspace); await assert.rejects(()=>runDeclaredGate(task,{id:'evil',category:'unit',command:'echo evil'}),/denied/u);
});
test('required gates stop after first failure by default', async () => {
  const workspace=await tempWorkspace(); const fail=`${process.execPath} -e "process.exit(1)"`; const pass=`${process.execPath} -e "process.exit(0)"`; const task=sampleTask(workspace,{allowed_bash_commands:[fail,pass],required_test_commands:[fail,pass]}); const results=await runRequiredGates(task); assert.equal(results.length,1); assert.equal(results[0].status,'FAIL');
});

test('manifest verification rejects unlisted source files', async () => {
  const workspace=await tempWorkspace('manifest-');
  const listed=Buffer.from('listed\n','utf8');
  await writeFile(join(workspace,'listed.txt'),listed);
  await writeFile(join(workspace,'unlisted.txt'),'unlisted\n');
  await writeFile(join(workspace,'SOURCE_MANIFEST.json'),JSON.stringify({
    schema_version:'forgeai.source-manifest.v0.1.1',
    generated_at:'2026-08-13T00:00:00.000Z',
    files:[{
      path:'listed.txt',
      bytes:listed.length,
      sha256:createHash('sha256').update(listed).digest('hex'),
    }],
  }));
  const checker=fileURLToPath(new URL('../scripts/check-manifest.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[checker],{cwd:workspace,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/unlisted file: unlisted\.txt/u);
});

test('manifest verification rejects entries outside source inventory', async () => {
  const workspace=await tempWorkspace('manifest-');
  const outside=await tempWorkspace('manifest-outside-');
  const listed=Buffer.from('listed\n','utf8');
  const external=Buffer.from('external\n','utf8');
  const externalPath=join(outside,'external.txt');
  await writeFile(join(workspace,'listed.txt'),listed);
  await writeFile(externalPath,external);
  await writeFile(join(workspace,'SOURCE_MANIFEST.json'),JSON.stringify({
    schema_version:'forgeai.source-manifest.v0.1.1',
    generated_at:'2026-08-14T00:00:00.000Z',
    files:[
      {
        path:'listed.txt',
        bytes:listed.length,
        sha256:createHash('sha256').update(listed).digest('hex'),
      },
      {
        path:externalPath,
        bytes:external.length,
        sha256:createHash('sha256').update(external).digest('hex'),
      },
    ],
  }));
  const checker=fileURLToPath(new URL('../scripts/check-manifest.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[checker],{cwd:workspace,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/outside source inventory/u);
});

test('secret scan passes clean files', async () => {
  const workspace=await tempWorkspace(); await writeFile(join(workspace,'src','clean.js'),"export const value = 'public';\n"); const result=await scanSecrets(workspace); assert.equal(result.status,'PASS');
});
test('secret scan finds private keys without returning the secret', async () => {
  const workspace=await tempWorkspace(); await writeFile(join(workspace,'src','key.txt'),'-----BEGIN PRIVATE KEY-----\nsecret\n'); const result=await scanSecrets(workspace); assert.equal(result.status,'FAIL'); assert.equal(result.findings[0].code,'PRIVATE_KEY'); assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('secret scan finds provider keys', async () => {
  const workspace=await tempWorkspace(); await writeFile(join(workspace,'src','config.js'),"const key='sk-ant-abcdefghijklmnopqrstuvwxyz123456';\n"); const result=await scanSecrets(workspace); assert.equal(result.status,'FAIL'); assert.deepEqual(result.findings.map((finding)=>finding.code),['ANTHROPIC_KEY']);
});
test('secret scan ignores binary files', async () => {
  const workspace=await tempWorkspace(); await writeFile(join(workspace,'src','image.png'),Buffer.from('-----BEGIN PRIVATE KEY-----')); const result=await scanSecrets(workspace); assert.equal(result.status,'PASS');
});

test('gate runner rejects shell syntax before spawn',async()=>{const w=await tempWorkspace();const command='node -e "process.exit(0)"; echo bypass';const t=sampleTask(w,{allowed_bash_commands:[command],required_test_commands:[command]});await assert.rejects(()=>runDeclaredGate(t,{id:'shell',category:'unit',command}),/shell syntax/u);});
test('gate runner fails on output overflow',async()=>{const w=await tempWorkspace();const command=`${process.execPath} -e "process.stdout.write('x'.repeat(11*1024*1024))"`;const t=sampleTask(w,{allowed_bash_commands:[command],required_test_commands:[command]});const r=await runDeclaredGate(t,{id:'overflow',category:'unit',command},{timeoutMs:10000});assert.equal(r.status,'FAIL');assert.equal(r.output_overflow,true);});
test('gate runner kills timed out process group',async()=>{const w=await tempWorkspace();const command=`${process.execPath} -e "setInterval(()=>{},1000)"`;const t=sampleTask(w,{allowed_bash_commands:[command],required_test_commands:[command]});const r=await runDeclaredGate(t,{id:'timeout',category:'unit',command},{timeoutMs:80});assert.equal(r.status,'FAIL');assert.equal(r.timed_out,true);});

test('secret scan rejects a requested path absent from inventory',async()=>{const w=await tempWorkspace();await assert.rejects(()=>scanSecrets(w,{paths:['src/missing.js']}),/absent from stable inventory/u);});
