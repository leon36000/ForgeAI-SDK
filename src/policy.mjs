import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalCommand, commandIdentity, parseCommandLine } from './command.mjs';
import { matchesAny, toPosixPath } from './glob.mjs';
import { normalizedTaskEnvelope } from './contracts.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const PROTECTED_PATHS = Object.freeze([
  '.git/**', '.forgeai/**', '.claude/settings.json', '.claude/settings.local.json', '.claude/agents/**', '.claude/hooks/**',
  '.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa', '**/id_rsa.*',
]);
const SHELL_WRAPPERS = new Set(['sh','bash','zsh','dash','ksh','fish','pwsh','powershell','powershell.exe','cmd','cmd.exe']);

function decision(allowed, code, reason, details = {}) { return Object.freeze({ allowed, code, reason, details }); }
function isInside(workspace, candidate) { const rel = relative(workspace, candidate); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); }
function resolvePhysicalCandidate(workspace, candidate) {
  const missing=[]; let cursor=candidate;
  while(!existsSync(cursor)){missing.unshift(basename(cursor));const parent=dirname(cursor);if(parent===cursor)throw new Error('unable to resolve path');cursor=parent;}
  const physicalBase=realpathSync(cursor); const physical=resolve(physicalBase,...missing);
  if(!isInside(workspace,physical))throw new Error('path traverses an escaping symlink');
  return physical;
}
function containsSymlink(workspace,candidate){const rel=relative(workspace,candidate);let cursor=workspace;for(const part of rel.split(sep).filter(Boolean)){cursor=resolve(cursor,part);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())return true;}return false;}

export function normalizeRepoPath(workspaceValue,pathValue,{write=false}={}){
  const workspace=realpathSync(resolve(workspaceValue));
  if(typeof pathValue!=='string'||pathValue.length===0||/[\u0000\u000a\u000d\u202a-\u202e\u2066-\u2069]/u.test(pathValue))throw new Error('path is empty or contains forbidden control characters');
  const candidate=resolve(workspace,pathValue); if(!isInside(workspace,candidate))throw new Error('path escapes workspace');
  const physical=resolvePhysicalCandidate(workspace,candidate); if(write&&containsSymlink(workspace,candidate))throw new Error('writes through symlinks are forbidden');
  return {workspace,absolute:candidate,physical,relative:toPosixPath(relative(workspace,candidate))||'.',physical_relative:toPosixPath(relative(workspace,physical))||'.'};
}

export function checkPath(taskValue,pathValue,{write=false}={}){
  const task=normalizedTaskEnvelope(taskValue); let normalized;
  try{normalized=normalizeRepoPath(task.workspace,pathValue,{write});}catch(error){return decision(false,'PATH_INVALID',error.message);}
  const denied=[...PROTECTED_PATHS,...task.denied_paths];
  if(matchesAny(normalized.relative,denied)||matchesAny(normalized.physical_relative,denied))return decision(false,'PATH_DENIED',`path is denied: ${normalized.relative}`);
  if(!matchesAny(normalized.relative,task.allowed_paths)||!matchesAny(normalized.physical_relative,task.allowed_paths))return decision(false,'PATH_OUT_OF_SCOPE',`path is outside allowed scope: ${normalized.relative}`);
  if(write&&task.role!=='writer')return decision(false,'ROLE_READ_ONLY',`${task.role} cannot write`);
  if(write&&task.mode!=='EXECUTE')return decision(false,'MODE_READ_ONLY',`${task.mode} cannot write`);
  return decision(true,'ALLOW','path allowed',normalized);
}

function commandRisk(args, task) {
  const executable=args[0].toLowerCase(); const base=executable.split(/[\\/]/u).at(-1);
  if(base==='sudo'||base==='doas')return 'privilege escalation is forbidden';
  if(SHELL_WRAPPERS.has(base))return 'shell wrappers are forbidden';
  if(base==='env'&&args.length>1&&SHELL_WRAPPERS.has(args[1].toLowerCase().split(/[\\/]/u).at(-1)))return 'shell wrappers are forbidden';
  if(base==='git'&&args[1]==='reset'&&args.includes('--hard'))return 'git reset --hard is forbidden';
  if(base==='git'&&args[1]==='clean'&&args.slice(2).some((arg)=>arg==='-f'||arg==='--force'||(/^-[^-]/u.test(arg)&&arg.includes('f'))))return 'forced git clean is forbidden';
  if(['mkfs','shutdown','reboot','poweroff'].includes(base))return 'destructive system command is forbidden';
  if(base==='rm'){
    const recursive=args.slice(1).some((arg)=>arg==='-r'||arg==='-R'||arg==='--recursive'||(/^-[^-]/u.test(arg)&&/[rR]/u.test(arg)));
    const forced=args.slice(1).some((arg)=>arg==='-f'||arg==='--force'||(/^-[^-]/u.test(arg)&&arg.includes('f')));
    if(recursive&&forced){
      for(const arg of args.slice(1).filter((item)=>!item.startsWith('-'))){
        const target=resolve(task.workspace,arg); if(target===resolve(task.workspace)||!isInside(resolve(task.workspace),target))return 'recursive forced removal of workspace root or external paths is forbidden';
      }
    }
  }
  return null;
}

export function checkCommand(taskValue,commandValue){
  const task=normalizedTaskEnvelope(taskValue); let args,identity;
  try{args=parseCommandLine(commandValue);identity=JSON.stringify(args);}catch(error){return decision(false,'COMMAND_INVALID',error.message);}
  const risk=commandRisk(args,task); if(risk)return decision(false,'COMMAND_DESTRUCTIVE',risk);
  const allowed=new Set(task.allowed_bash_commands.map(commandIdentity));
  if(!allowed.has(identity))return decision(false,'COMMAND_NOT_DECLARED','command is not in allowed_bash_commands');
  return decision(true,'ALLOW','command allowed',{command:canonicalCommand(commandValue),argv:args});
}

export function checkNetwork(taskValue,urlValue){
  const task=normalizedTaskEnvelope(taskValue); let url;
  try{url=new URL(urlValue);}catch{return decision(false,'URL_INVALID','network target is not a valid URL');}
  if(!['http:','https:'].includes(url.protocol))return decision(false,'NETWORK_PROTOCOL_DENIED',`protocol is not allowed: ${url.protocol}`);
  const host=url.hostname.toLowerCase(); const allowed=task.allowed_network_hosts.some((rule)=>{const normalized=rule.toLowerCase();return normalized.startsWith('*.')?host.endsWith(normalized.slice(1))&&host!==normalized.slice(2):host===normalized;});
  return allowed?decision(true,'ALLOW','network host allowed',{host}):decision(false,'NETWORK_DENIED',`host is not allowed: ${host}`);
}

export function checkToolUse(taskValue,toolName,input={}){
  const task=normalizedTaskEnvelope(taskValue);
  if(typeof toolName!=='string'||toolName.length===0)return decision(false,'TOOL_INVALID','tool name must be a non-empty string');
  if(WRITE_TOOLS.has(toolName)){const path=input.file_path??input.path??input.notebook_path;return checkPath(task,path,{write:true});}
  if(READ_TOOLS.has(toolName)){const path=input.file_path??input.path??'.';return checkPath(task,path,{write:false});}
  if(toolName==='Bash')return checkCommand(task,input.command);
  if(toolName==='WebFetch')return checkNetwork(task,input.url);
  if(toolName.startsWith('mcp__')){
    if(task.mode==='EXECUTE')return decision(false,'MCP_EXECUTE_DENIED','external MCP calls are advisory only during EXECUTE');
    if(!task.allowed_mcp_tools.includes(toolName))return decision(false,'MCP_TOOL_NOT_DECLARED','MCP tool is not allowlisted');
    return decision(true,'ALLOW','declared read-only MCP consultation allowed');
  }
  return decision(false,'TOOL_NOT_DECLARED',`tool is not governed: ${toolName}`);
}
export function isProtectedRepoPath(path){return matchesAny(toPosixPath(path),PROTECTED_PATHS);}
export const POLICY_CONSTANTS=Object.freeze({PROTECTED_PATHS,WRITE_TOOLS:[...WRITE_TOOLS],READ_TOOLS:[...READ_TOOLS]});
