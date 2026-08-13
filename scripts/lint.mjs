import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const forbidden = [/\bTODO\b/u, /\bFIXME\b/u, /\bTBD\b/u, /CHANGEME/u];
async function collect(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, out);
    else if (entry.isFile() && /\.(?:mjs|json|md|sql|ya?ml)$/u.test(path)) out.push(path);
  }
  return out;
}
const files=[];
for (const directory of ['src','bin','scripts','config','schemas','docs','examples','.claude','.github','sql']) files.push(...await collect(directory));
const findings=[];
for (const file of files) {
  if (file === 'scripts/lint.mjs') continue;
  const text=await readFile(file,'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) findings.push(`${file}: ${pattern}`);
  if (text.includes('\r\n')) findings.push(`${file}: CRLF is forbidden`);
}
const build=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8'});
if (build.status!==0) findings.push(build.stderr || 'syntax check failed');
if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`lint PASS (${files.length} files)\n`);
