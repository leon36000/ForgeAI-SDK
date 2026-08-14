import { spawnSync } from 'node:child_process';
import { readStableRegularFile } from '../src/safe-file.mjs';
import { collectRegularFiles } from '../src/file-tree.mjs';
const forbidden=[/\bTODO\b/u,/\bFIXME\b/u,/\bTBD\b/u,/CHANGEME/u];const files=[];
for(const directory of ['src','bin','scripts','config','schemas','docs','examples','.claude','.github','sql'])for(const entry of await collectRegularFiles(directory,{include:path=>/\.(?:mjs|json|md|sql|ya?ml)$/u.test(path)}))files.push(entry.absolute);
const findings=[];for(const file of files){if(file.endsWith('/scripts/lint.mjs')||file==='scripts/lint.mjs')continue;const text=(await readStableRegularFile(file,{maxBytes:8*1024*1024})).bytes.toString('utf8');for(const pattern of forbidden)if(pattern.test(text))findings.push(`${file}: ${pattern}`);if(text.includes('\r\n'))findings.push(`${file}: CRLF is forbidden`);}const build=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8',shell:false});if(build.status!==0)findings.push(build.stderr||'syntax check failed');if(findings.length){process.stderr.write(`${findings.join('\n')}\n`);process.exit(1);}process.stdout.write(`lint PASS (${files.length} files)\n`);
