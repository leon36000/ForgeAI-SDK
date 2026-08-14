import { relative, resolve } from 'node:path';
import { EVIDENCE_SCHEMA_VERSION, taskEnvelopeHash } from './contracts.mjs';
import { collectRegularFiles } from './file-tree.mjs';
import { toPosixPath } from './glob.mjs';
import { readStableRegularFile } from './safe-file.mjs';
import { assertIsoDate, assertOnlyKeys, canonicalize, hashCanonical, isPlainObject, sha256, uniqSorted } from './utils.mjs';

const LIMITS=Object.freeze({bundle_bytes:8*1024*1024,changed_files:4096,gates:512,acceptance:256,reviews:128,findings:2048,artifacts:8192});
const BUNDLE_KEYS=['schema_version','task_id','task_envelope_hash','base_commit','final_commit','generated_at','changed_files','git','gates','acceptance','reviews','findings','artifacts','ledger_head','human_approval','bundle_hash'];
const GIT_KEYS=['head','clean','base_is_ancestor'];
const GATE_KEYS=['id','category','command','status','exit_code','duration_ms','stdout_sha256','stderr_sha256','signal','timed_out','output_overflow','stdout_path','stderr_path'];
const ACCEPTANCE_KEYS=['id','status','evidence'];
const REVIEW_KEYS=['role','model','session_id','verdict','context_fresh','findings_count','evidence_hash','final_commit'];
const FINDING_KEYS=['severity','status','code','path','message','evidence_hash','resolution'];
const ARTIFACT_KEYS=['path','bytes','sha256'];
const LEDGER_KEYS=['count','last_hash'];
const APPROVAL_KEYS=['status','commit','approver','approved_at'];

function isSha(value){return typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);}
function safeRelativePath(value){return typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.split('/').includes('..')&&!/[\u0000\u000a\u000d]/u.test(value);}
function addUnexpected(findings,value,allowed,code,label){if(!isPlainObject(value)){findings.push({code,message:`${label} must be an object`});return false;}const extra=Object.keys(value).filter(k=>!allowed.includes(k));if(extra.length)findings.push({code,message:`${label} has unexpected keys`,keys:extra});return true;}
function boundedArray(findings,value,max,code,label){if(!Array.isArray(value)){findings.push({code,message:`${label} must be an array`});return [];}if(value.length>max)findings.push({code,message:`${label} exceeds maximum ${max}`,count:value.length});return value.slice(0,max+1);}

function validateGit(bundle,findings){if(!addUnexpected(findings,bundle.git,GIT_KEYS,'BUNDLE_GIT','git'))return;if(typeof bundle.git.head!=='string'||typeof bundle.git.clean!=='boolean'||typeof bundle.git.base_is_ancestor!=='boolean')findings.push({code:'BUNDLE_GIT_SHAPE'});}
function validateGates(bundle,findings){for(const gate of boundedArray(findings,bundle.gates,LIMITS.gates,'BUNDLE_GATES_LIMIT','gates')){if(!addUnexpected(findings,gate,GATE_KEYS,'BUNDLE_GATE_KEYS','gate'))continue;if(typeof gate.id!=='string'||typeof gate.category!=='string'||typeof gate.command!=='string')findings.push({code:'BUNDLE_GATE_SHAPE'});if(!['PASS','FAIL','BLOCKED','SKIPPED'].includes(gate.status))findings.push({code:'BUNDLE_GATE_STATUS',id:gate.id});if(!Number.isInteger(gate.exit_code))findings.push({code:'BUNDLE_GATE_EXIT',id:gate.id});if(!Number.isFinite(gate.duration_ms)||gate.duration_ms<0)findings.push({code:'BUNDLE_GATE_DURATION',id:gate.id});for(const key of ['stdout_sha256','stderr_sha256'])if(!isSha(gate[key]))findings.push({code:'BUNDLE_GATE_HASH',id:gate.id,field:key});}}
function validateAcceptance(bundle,findings){for(const item of boundedArray(findings,bundle.acceptance,LIMITS.acceptance,'BUNDLE_ACCEPTANCE_LIMIT','acceptance')){if(!addUnexpected(findings,item,ACCEPTANCE_KEYS,'BUNDLE_ACCEPTANCE_KEYS','acceptance item'))continue;if(typeof item.id!=='string'||!['PASS','FAIL','BLOCKED'].includes(item.status)||typeof item.evidence!=='string')findings.push({code:'BUNDLE_ACCEPTANCE_SHAPE'});}}
function validateReviews(bundle,task,findings){for(const review of boundedArray(findings,bundle.reviews,LIMITS.reviews,'BUNDLE_REVIEWS_LIMIT','reviews')){if(!addUnexpected(findings,review,REVIEW_KEYS,'BUNDLE_REVIEW_KEYS','review'))continue;if(typeof review.role!=='string'||typeof review.model!=='string'||typeof review.session_id!=='string')findings.push({code:'BUNDLE_REVIEW_SHAPE'});if(!['PASS','FAIL','BLOCKED'].includes(review.verdict))findings.push({code:'BUNDLE_REVIEW_VERDICT'});if(typeof review.context_fresh!=='boolean'||!Number.isInteger(review.findings_count)||review.findings_count<0) findings.push({code:'BUNDLE_REVIEW_CONTEXT'});if(!isSha(review.evidence_hash))findings.push({code:'BUNDLE_REVIEW_HASH'});if(review.final_commit!==bundle.final_commit)findings.push({code:'BUNDLE_REVIEW_COMMIT'});if(review.session_id===task?.metadata?.writer_session_id)findings.push({code:'BUNDLE_REVIEW_NOT_INDEPENDENT'});}}
function validateFindings(bundle,findings){for(const item of boundedArray(findings,bundle.findings,LIMITS.findings,'BUNDLE_FINDINGS_LIMIT','findings')){if(!addUnexpected(findings,item,FINDING_KEYS,'BUNDLE_FINDING_KEYS','finding'))continue;if(!['info','low','medium','high','critical'].includes(item.severity)||!['OPEN','RESOLVED','ACCEPTED_RISK','REJECTED'].includes(item.status)||typeof item.code!=='string')findings.push({code:'BUNDLE_FINDING_SHAPE'});if(item.path!==undefined&&!safeRelativePath(item.path))findings.push({code:'BUNDLE_FINDING_PATH'});if(item.evidence_hash!==undefined&&!isSha(item.evidence_hash))findings.push({code:'BUNDLE_FINDING_HASH'});}}
function validateArtifacts(bundle,findings){for(const item of boundedArray(findings,bundle.artifacts,LIMITS.artifacts,'BUNDLE_ARTIFACTS_LIMIT','artifacts')){if(!addUnexpected(findings,item,ARTIFACT_KEYS,'BUNDLE_ARTIFACT_KEYS','artifact'))continue;if(!safeRelativePath(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!isSha(item.sha256))findings.push({code:'BUNDLE_ARTIFACT_SHAPE'});}}
function validateLedger(bundle,findings){if(!addUnexpected(findings,bundle.ledger_head,LEDGER_KEYS,'BUNDLE_LEDGER_KEYS','ledger_head'))return;if(!Number.isInteger(bundle.ledger_head.count)||bundle.ledger_head.count<0||!isSha(bundle.ledger_head.last_hash))findings.push({code:'BUNDLE_LEDGER_HEAD'});}
function validateApproval(bundle,findings){if(bundle.human_approval===null)return;if(!addUnexpected(findings,bundle.human_approval,APPROVAL_KEYS,'BUNDLE_APPROVAL_KEYS','human_approval'))return;const a=bundle.human_approval;if(a.status!=='APPROVED'||typeof a.commit!=='string'||typeof a.approver!=='string'||typeof a.approved_at!=='string')findings.push({code:'BUNDLE_APPROVAL_SHAPE'});}

export function sealEvidenceBundle(bundleValue){
  if(!isPlainObject(bundleValue))throw new TypeError('evidence bundle draft must be a plain object');
  const bundle=structuredClone(bundleValue);bundle.schema_version=EVIDENCE_SCHEMA_VERSION;delete bundle.bundle_hash;
  bundle.changed_files=uniqSorted(bundle.changed_files??[]);bundle.gates=[...(bundle.gates??[])].sort((a,b)=>`${a.id}:${a.command}`.localeCompare(`${b.id}:${b.command}`));bundle.acceptance=[...(bundle.acceptance??[])].sort((a,b)=>a.id.localeCompare(b.id));bundle.reviews=[...(bundle.reviews??[])].sort((a,b)=>`${a.role}:${a.session_id}`.localeCompare(`${b.role}:${b.session_id}`));bundle.findings=[...(bundle.findings??[])].sort((a,b)=>`${a.severity}:${a.code}:${a.path??''}`.localeCompare(`${b.severity}:${b.code}:${b.path??''}`));bundle.artifacts=[...(bundle.artifacts??[])].sort((a,b)=>a.path.localeCompare(b.path));
  if(Buffer.byteLength(canonicalize(bundle),'utf8')>LIMITS.bundle_bytes)throw new Error(`evidence bundle exceeds maximum ${LIMITS.bundle_bytes} bytes`);
  bundle.bundle_hash=hashCanonical(bundle);return Object.freeze(bundle);
}

export function verifyEvidenceBundle(bundle,task){
  const findings=[];
  try{
    if(!isPlainObject(bundle))return{valid:false,findings:[{code:'BUNDLE_INVALID'}]};
    const size=Buffer.byteLength(canonicalize(bundle),'utf8');if(size>LIMITS.bundle_bytes)findings.push({code:'BUNDLE_SIZE',bytes:size});
    addUnexpected(findings,bundle,BUNDLE_KEYS,'BUNDLE_UNEXPECTED_KEYS','bundle');
    if(bundle.schema_version!==EVIDENCE_SCHEMA_VERSION)findings.push({code:'BUNDLE_SCHEMA'});if(bundle.task_id!==task?.task_id)findings.push({code:'BUNDLE_TASK_ID'});
    try{if(bundle.task_envelope_hash!==taskEnvelopeHash(task))findings.push({code:'BUNDLE_TASK_HASH'});}catch(error){findings.push({code:'BUNDLE_TASK_INVALID',message:error.message});}
    if(bundle.base_commit!==task?.base_commit)findings.push({code:'BUNDLE_BASE_COMMIT'});if(typeof bundle.final_commit!=='string'||!/^[0-9a-f]{7,64}$/iu.test(bundle.final_commit))findings.push({code:'BUNDLE_FINAL_COMMIT'});
    try{assertIsoDate(bundle.generated_at,'bundle.generated_at');}catch(error){findings.push({code:'BUNDLE_DATE',message:error.message});}
    const changed=boundedArray(findings,bundle.changed_files,LIMITS.changed_files,'BUNDLE_CHANGED_FILES_LIMIT','changed_files');if(changed.some(item=>!safeRelativePath(item)))findings.push({code:'BUNDLE_CHANGED_FILES'});
    validateGit(bundle,findings);validateGates(bundle,findings);validateAcceptance(bundle,findings);validateReviews(bundle,task,findings);validateFindings(bundle,findings);validateArtifacts(bundle,findings);validateLedger(bundle,findings);validateApproval(bundle,findings);
    const copy=structuredClone(bundle);const actualHash=copy.bundle_hash;delete copy.bundle_hash;if(!isSha(actualHash)||actualHash!==hashCanonical(copy))findings.push({code:'BUNDLE_HASH'});
  }catch(error){findings.push({code:'BUNDLE_VALIDATION_ERROR',message:error.message});}
  return Object.freeze({valid:findings.length===0,findings});
}

export async function buildArtifactManifest(directory){
  const root=resolve(directory);const files=await collectRegularFiles(root,{maxFiles:LIMITS.artifacts});const out=[];
  for(const file of files){const read=await readStableRegularFile(file.absolute,{maxBytes:64*1024*1024});out.push({path:toPosixPath(relative(root,file.absolute)),bytes:read.size,sha256:sha256(read.bytes)});}
  return out.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function verifyArtifactManifest(directory,manifest){if(!Array.isArray(manifest)||manifest.length>LIMITS.artifacts)return Object.freeze({valid:false,actual:[]});const actual=await buildArtifactManifest(directory);const expected=[...manifest].sort((a,b)=>a.path.localeCompare(b.path));return Object.freeze({valid:hashCanonical(actual)===hashCanonical(expected),actual});}
export const EVIDENCE_LIMITS=LIMITS;
