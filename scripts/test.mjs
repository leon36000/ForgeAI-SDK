import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { collectRegularFiles } from '../src/file-tree.mjs';
await rm('.forgeai-test-tmp',{recursive:true,force:true});const build=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8',shell:false});process.stdout.write(build.stdout);process.stderr.write(build.stderr);if(build.status!==0)process.exit(build.status??1);const tests=(await collectRegularFiles('tests',{include:path=>path.endsWith('.test.mjs')})).map(x=>x.absolute).sort();if(tests.length===0)throw new Error('no tests found');const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests],{stdio:'inherit',shell:false});process.exit(result.status??1);
