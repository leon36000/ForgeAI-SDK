#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { appendLedgerEvent, initializeLedger, verifyLedger } from '../src/ledger.mjs';
import { validateTaskEnvelope } from '../src/contracts.mjs';
import { checkToolUse } from '../src/policy.mjs';
import { inspectGitState, verifyGitScope } from '../src/git-proof.mjs';
import { sealEvidenceBundle, verifyArtifactManifest } from '../src/evidence.mjs';
import { evaluateProof } from '../src/proof.mjs';
import { handleHook } from '../src/hook.mjs';
import { inventoryRepository } from '../src/inventory.mjs';
import { createBenchmarkSlots, computeBenchmarkMetrics } from '../src/benchmark.mjs';
import { createManagedWorktree, removeManagedWorktree } from '../src/worktree.mjs';
import { runRequiredGates } from '../src/gate-runner.mjs';
import { scanSecrets } from '../src/secret-scan.mjs';
import { atomicWriteJson, readJson } from '../src/utils.mjs';
import { SAFE_FILE_CAPABILITIES } from '../src/safe-file.mjs';
const MAX_STDIN_BYTES=8*1024*1024;
async function stdinText(){const chunks=[];let total=0;for await(const chunk of process.stdin){total+=chunk.length;if(total>MAX_STDIN_BYTES)throw new Error(`stdin exceeds maximum ${MAX_STDIN_BYTES} bytes`);chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
async function writeJson(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await atomicWriteJson(resolve(path),value);}
function usage(){return `forgeai-foundation commands:\n  doctor [workspace]\n  validate-task <task.json>\n  policy-check <task.json> <tool-name> <tool-input.json>\n  ledger-init <ledger-dir>\n  ledger-append <ledger-dir> <event.json>\n  ledger-verify <ledger-dir>\n  inventory <workspace> <output.json>\n  run-gates <task.json> <output.json>\n  scan-secrets <workspace> <output.json>\n  evidence-seal <draft.json> <output.json>\n  proof-verify <task.json> <evidence.json> <artifact-dir> <ledger-dir> [output.json]\n  benchmark-init <output.json>\n  benchmark-metrics <runs.json> [output.json]\n  worktree-create <repo> <task-id> <base-commit>\n  worktree-remove <repo> <task-id> [--force]\n  hook <event-name>\n`;}
function print(value){process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
async function core(command,args){
 if(command==='doctor'){const report=await inventoryRepository(args[0]??'.');const missing=['node','git'].filter(key=>!report.tools[key]);if(!SAFE_FILE_CAPABILITIES.secure_no_follow)missing.push('secure_no_follow');const result={...report,status:missing.length===0?'PASS':'BLOCKED',missing_required_tools:missing};print(result);if(missing.length)process.exitCode=2;return;}
 if(command==='validate-task'){const task=await readJson(args[0]);validateTaskEnvelope(task);print({valid:true,task_id:task.task_id});return;}
 if(command==='policy-check'){const result=checkToolUse(await readJson(args[0]),args[1],await readJson(args[2]));print(result);if(!result.allowed)process.exitCode=2;return;}
 if(command==='ledger-init'){print(await initializeLedger(resolve(args[0])));return;}
 if(command==='ledger-append'){print(await appendLedgerEvent(resolve(args[0]),await readJson(args[1])));return;}
 if(command==='ledger-verify'){print(await verifyLedger(resolve(args[0])));return;}
 if(command==='inventory'){const result=await inventoryRepository(args[0]);await writeJson(args[1],result);print({status:'PASS',output:resolve(args[1]),files:result.files.length});return;}
 if(command==='run-gates'){const task=await readJson(args[0]);validateTaskEnvelope(task);const results=await runRequiredGates(task);await writeJson(args[1],results);const status=results.length===task.required_test_commands.length&&results.every(item=>item.status==='PASS')?'PASS':'BLOCKED';print({status,output:resolve(args[1]),gates:results.length});if(status!=='PASS')process.exitCode=2;return;}
 if(command==='scan-secrets'){const result=await scanSecrets(args[0]);await writeJson(args[1],result);print(result);if(result.status!=='PASS')process.exitCode=2;return;}
 if(command==='evidence-seal'){const result=sealEvidenceBundle(await readJson(args[0],{maxBytes:8*1024*1024}));await writeJson(args[1],result);print({status:'PASS',output:resolve(args[1]),bundle_hash:result.bundle_hash});return;}
 if(command==='proof-verify'){const[taskPath,evidencePath,artifactDir,ledgerDir,outputPath]=args;const task=await readJson(taskPath);const evidence=await readJson(evidencePath,{maxBytes:8*1024*1024});validateTaskEnvelope(task);const ledgerVerification=await verifyLedger(resolve(ledgerDir));const gitState=inspectGitState(task.workspace,task.base_commit,evidence.final_commit);const gitScope=verifyGitScope(gitState,task);const artifactVerification=await verifyArtifactManifest(resolve(artifactDir),evidence.artifacts);const result=evaluateProof(task,evidence,{ledgerVerification,gitState,gitScope,artifactVerification});if(outputPath)await writeJson(outputPath,result);print(result);if(result.verdict!=='PASS')process.exitCode=2;return;}
 if(command==='benchmark-init'){await writeJson(args[0],createBenchmarkSlots());print({status:'PASS',output:resolve(args[0]),slots:15});return;}
 if(command==='benchmark-metrics'){const result=computeBenchmarkMetrics(await readJson(args[0]));if(args[1])await writeJson(args[1],result);print(result);return;}
 if(command==='worktree-create'){print(await createManagedWorktree(args[0],args[1],args[2]));return;}
 if(command==='worktree-remove'){print(await removeManagedWorktree(args[0],args[1],{force:args.includes('--force')}));return;}
 if(command==='hook'){const raw=await stdinText();const event=raw.trim()?JSON.parse(raw):{};const result=await handleHook(args[0],event);if(result.stdout)process.stdout.write(`${result.stdout}\n`);if(result.stderr)process.stderr.write(`${result.stderr}\n`);process.exitCode=result.exitCode;return;}
 throw new Error(`unknown command: ${command}\n${usage()}`);
}
async function main(argv){const[command,...args]=argv;if(!command||['help','--help','-h'].includes(command)){process.stdout.write(usage());return;}await core(command,args);}
main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error.stack??error.message}\n`);process.exitCode=1;});
