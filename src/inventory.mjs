import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectRegularFiles } from './file-tree.mjs';
import { readStableRegularFile, SAFE_FILE_CAPABILITIES } from './safe-file.mjs';
import { sha256 } from './utils.mjs';
const EXCLUDED=['.git','node_modules','.forgeai/worktrees','.scannerwork','verification'];
function excluded(path){return EXCLUDED.some(item=>path===item||path.startsWith(`${item}/`));}
function version(command,args){const result=spawnSync(command,args,{encoding:'utf8',shell:false});return result.status===0?(result.stdout||result.stderr).trim().split('\n')[0]:null;}
export async function inventoryRepository(workspaceValue){const workspace=resolve(workspaceValue);const entries=await collectRegularFiles(workspace,{exclude:excluded,maxFiles:100000});const files=[];for(const entry of entries){const read=await readStableRegularFile(entry.absolute,{maxBytes:64*1024*1024});files.push({path:entry.relative,bytes:read.size,sha256:sha256(read.bytes)});}return Object.freeze({schema_version:'forgeai.inventory.v0.1.1',generated_at:new Date().toISOString(),workspace,capabilities:{secure_no_follow:SAFE_FILE_CAPABILITIES.secure_no_follow},tools:{node:version('node',['--version']),npm:version('npm',['--version']),git:version('git',['--version']),sonar_scanner:version(process.env.SONAR_SCANNER_BIN??'sonar-scanner',['--version'])},files});}
