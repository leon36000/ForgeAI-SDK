import { cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicWriteText, readJson } from '../src/utils.mjs';
import { readStableRegularFile } from '../src/safe-file.mjs';

const args=process.argv.slice(2);const target=resolve(args.find(item=>!item.startsWith('--'))??'.');const apply=args.includes('--apply');const force=args.includes('--force');const root=resolve(new URL('..',import.meta.url).pathname);
const git=spawnSync('git',['-C',target,'rev-parse','--show-toplevel'],{encoding:'utf8',shell:false});if(git.status!==0||resolve(git.stdout.trim())!==target)throw new Error('target must be a Git repository root');if(target===root||target.startsWith(`${root}/`))throw new Error('refusing to install Foundation into itself');
const destination=join(target,'.forgeai','foundation');const agentsDestination=join(target,'.claude','agents');const hooksDestination=join(target,'.claude','hooks');const planned={target,destination,copy_agents:true,merge_hooks:true};if(!apply){process.stdout.write(`${JSON.stringify({mode:'DRY_RUN',...planned},null,2)}\n`);process.exit(0);}
async function info(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function ensureDirectory(path){const existing=await info(path);if(existing){if(existing.isSymbolicLink()||!existing.isDirectory())throw new Error(`expected real directory: ${path}`);return;}await mkdir(path,{recursive:true,mode:0o700});const created=await lstat(path);if(created.isSymbolicLink()||!created.isDirectory())throw new Error(`failed to create real directory: ${path}`);}
async function readOptionalText(path,maxBytes=4*1024*1024){const existing=await info(path);if(!existing)return null;if(existing.isSymbolicLink()||!existing.isFile())throw new Error(`expected regular file: ${path}`);return(await readStableRegularFile(path,{maxBytes})).bytes.toString('utf8');}
await ensureDirectory(join(target,'.forgeai'));await ensureDirectory(join(target,'.claude'));await ensureDirectory(agentsDestination);await ensureDirectory(hooksDestination);
const existingDestination=await info(destination);if(existingDestination&&!force)throw new Error('Foundation already exists; use --force to replace it');if(existingDestination&&(existingDestination.isSymbolicLink()||!existingDestination.isDirectory()))throw new Error('Foundation destination must be a real directory');
const agentNames=await readdir(join(root,'.claude','agents'));for(const name of agentNames){const path=join(agentsDestination,name);const existing=await info(path);if(existing&&!force)throw new Error(`agent profile already exists: ${name}`);if(existing&&(existing.isSymbolicLink()||!existing.isFile()))throw new Error(`agent profile path is unsafe: ${name}`);}
const hookPath=join(hooksDestination,'forgeai-hook.mjs');const hookExisting=await info(hookPath);if(hookExisting&&(hookExisting.isSymbolicLink()||!hookExisting.isFile()))throw new Error('ForgeAI hook path is unsafe');
const settingsPath=join(target,'.claude','settings.json');let settings={};const settingsText=await readOptionalText(settingsPath);if(settingsText!==null)settings=JSON.parse(settingsText);const fragment=await readJson(join(root,'.claude','settings.fragment.json'));
settings.hooks??={};for(const[event,entries]of Object.entries(fragment.hooks)){const existing=settings.hooks[event]??[];const signatures=new Set(existing.flatMap(entry=>(entry.hooks??[]).map(hook=>hook.command)));settings.hooks[event]=[...existing,...entries.filter(entry=>!(entry.hooks??[]).some(hook=>signatures.has(hook.command)))];}
const gitignorePath=join(target,'.gitignore');let gitignore=(await readOptionalText(gitignorePath))??'';const ignoreEntries=['.forgeai/runtime/','.forgeai/worktrees/','.forgeai/ledger/','.forgeai/evidence/','.scannerwork/'];for(const entry of ignoreEntries)if(!gitignore.split(/\r?\n/u).includes(entry))gitignore+=`${gitignore.endsWith('\n')||gitignore.length===0?'':'\n'}${entry}\n`;
const stage=join(target,'.forgeai',`.foundation-stage-${randomUUID()}`);const backup=join(target,'.forgeai',`.foundation-backup-${randomUUID()}`);let backedUp=false;
try{
 await mkdir(stage,{mode:0o700});for(const entry of ['src','bin','config','schemas','package.json','README.md'])await cp(join(root,entry),join(stage,entry),{recursive:true,force:false,errorOnExist:true});
 if(existingDestination){await rename(destination,backup);backedUp=true;}await rename(stage,destination);
 for(const name of agentNames){const text=(await readStableRegularFile(join(root,'.claude','agents',name),{maxBytes:1024*1024})).bytes.toString('utf8');await atomicWriteText(join(agentsDestination,name),text,{mode:0o600});}
 const hookText=(await readStableRegularFile(join(root,'.claude','hooks','forgeai-hook.mjs'),{maxBytes:1024*1024})).bytes.toString('utf8');await atomicWriteText(hookPath,hookText,{mode:0o700});
 await atomicWriteText(settingsPath,`${JSON.stringify(settings,null,2)}\n`,{mode:0o600});await atomicWriteText(gitignorePath,gitignore,{mode:0o600});
 if(backedUp)await rm(backup,{recursive:true,force:true});
}catch(error){await rm(stage,{recursive:true,force:true}).catch(()=>{});if(backedUp){await rm(destination,{recursive:true,force:true}).catch(()=>{});await rename(backup,destination).catch(()=>{});}throw error;}
process.stdout.write(`${JSON.stringify({mode:'APPLIED',...planned},null,2)}\n`);
