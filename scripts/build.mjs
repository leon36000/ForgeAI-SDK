import { spawnSync } from 'node:child_process';
import { collectRegularFiles } from '../src/file-tree.mjs';
const files=[];for(const directory of ['src','bin','scripts','.claude/hooks'])for(const entry of await collectRegularFiles(directory,{include:path=>path.endsWith('.mjs')}))files.push(entry.absolute);
for(const file of files.sort()){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',shell:false});if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status??1);}}
process.stdout.write(`syntax-check PASS (${files.length} files)\n`);
