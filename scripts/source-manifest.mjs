import { resolve } from 'node:path';
import { collectRegularFiles } from '../src/file-tree.mjs';
import { readStableRegularFile } from '../src/safe-file.mjs';
import { atomicWriteJson, sha256 } from '../src/utils.mjs';
const excludedRoots=['.git','verification','.forgeai','.scannerwork'];const excludedNames=new Set(['SOURCE_MANIFEST.json','verification-full.log','verification-test.log','RELEASE_STATUS','TESTS_PASS','TESTS_FAIL']);
function excluded(path){return excludedNames.has(path)||excludedRoots.some(root=>path===root||path.startsWith(`${root}/`));}
const entries=await collectRegularFiles('.',{exclude:excluded,maxFiles:100000});const files=[];for(const entry of entries){const read=await readStableRegularFile(entry.absolute,{maxBytes:64*1024*1024});files.push({path:entry.relative,bytes:read.size,sha256:sha256(read.bytes)});}const manifest={schema_version:'forgeai.source-manifest.v0.1.1',generated_at:new Date().toISOString(),files};await atomicWriteJson(resolve('SOURCE_MANIFEST.json'),manifest);process.stdout.write(`manifest PASS (${files.length} files)\n`);
