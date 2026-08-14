import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkCommand } from './policy.mjs';
import { parseCommandLine } from './command.mjs';
import { atomicWriteFile, sha256 } from './utils.mjs';

const MAX_CAPTURE_BYTES=10*1024*1024;
function safeGateId(value,index){const normalized=String(value??`gate-${index+1}`).toLowerCase().replace(/[^a-z0-9._-]+/gu,'-').replace(/^-+|-+$/gu,'');if(!normalized)throw new Error('gate id is invalid');return normalized.slice(0,64);}
function killTree(child){if(!child.pid)return;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}}

export async function runDeclaredGate(task,gate,{index=0,env={},timeoutMs=15*60*1000}={}){
  const policy=checkCommand(task,gate.command);if(!policy.allowed)throw new Error(`gate command denied: ${policy.reason}`);
  const [file,...args]=parseCommandLine(gate.command);const id=safeGateId(gate.id,index);const outputDir=resolve(task.evidence_dir,'gate-logs');await mkdir(outputDir,{recursive:true,mode:0o700});
  const started=Date.now();let timedOut=false,overflow=false,terminated=false;
  const child=spawn(file,args,{cwd:task.workspace,env:{PATH:process.env.PATH,HOME:resolve(task.evidence_dir,'home'),USERPROFILE:resolve(task.evidence_dir,'home'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...env},shell:false,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
  const stdout=[];const stderr=[];let stdoutBytes=0;let stderrBytes=0;
  const capture=(bucket,isStdout)=>(chunk)=>{const next=(isStdout?stdoutBytes:stderrBytes)+chunk.length;if(isStdout)stdoutBytes=next;else stderrBytes=next;if(next<=MAX_CAPTURE_BYTES)bucket.push(chunk);else if(!terminated){overflow=true;terminated=true;killTree(child);}};
  child.stdout.on('data',capture(stdout,true));child.stderr.on('data',capture(stderr,false));
  const timeout=setTimeout(()=>{if(!terminated){timedOut=true;terminated=true;killTree(child);}},timeoutMs);timeout.unref?.();
  const {code,signal}=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',(exitCode,exitSignal)=>res({code:exitCode,signal:exitSignal}));});clearTimeout(timeout);
  const stdoutBuffer=Buffer.concat(stdout);const stderrBuffer=Buffer.concat(stderr);const stdoutPath=join(outputDir,`${id}.stdout.log`);const stderrPath=join(outputDir,`${id}.stderr.log`);
  await atomicWriteFile(stdoutPath,stdoutBuffer,{mode:0o600});await atomicWriteFile(stderrPath,stderrBuffer,{mode:0o600});
  const status=code===0&&!overflow&&!timedOut?'PASS':'FAIL';
  return Object.freeze({id,category:gate.category,command:policy.details.command,status,exit_code:Number.isInteger(code)?code:128,signal:signal??null,timed_out:timedOut,output_overflow:overflow,duration_ms:Date.now()-started,stdout_sha256:sha256(stdoutBuffer),stderr_sha256:sha256(stderrBuffer),stdout_path:stdoutPath,stderr_path:stderrPath});
}
export async function runRequiredGates(task,options={}){const categories=options.categories??{};const results=[];for(const [index,command]of task.required_test_commands.entries()){const result=await runDeclaredGate(task,{id:`required-${index+1}`,category:categories[command]??'unit',command},{...options,index});results.push(result);if(result.status!=='PASS'&&options.stopOnFailure!==false)break;}return results;}
