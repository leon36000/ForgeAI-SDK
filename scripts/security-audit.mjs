import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scanSecrets } from '../src/secret-scan.mjs';

const findings = [];
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) findings.push('runtime dependencies must remain empty');
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) findings.push('development dependencies must remain empty');

async function collect(cursor, out = []) {
  for (const entry of await readdir(cursor, { withFileTypes: true })) {
    const path = join(cursor, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) findings.push(`source symlink forbidden: ${path}`);
    else if (entry.isDirectory()) await collect(path, out);
    else if (entry.isFile()) out.push(path.replaceAll('\\', '/'));
  }
  return out;
}
const productionFiles = [];
for (const directory of ['src', 'bin', 'scripts', 'config', 'schemas', '.claude']) productionFiles.push(...await collect(directory));
for (const path of productionFiles.filter((item) => item.endsWith('.json'))) {
  try { JSON.parse(await readFile(path, 'utf8')); } catch (error) { findings.push(`invalid JSON ${path}: ${error.message}`); }
}
for (const path of productionFiles.filter((item) => item.endsWith('.mjs'))) {
  const text = await readFile(path, 'utf8');
  if (/\beval\s*\(/u.test(text)) findings.push(`eval forbidden: ${path}`);
  if (/\bnew\s+Function\s*\(/u.test(text)) findings.push(`new Function forbidden: ${path}`);
}
const gateRunner = await readFile('src/gate-runner.mjs', 'utf8');
if (!gateRunner.includes('checkCommand(task, gate.command)') || !gateRunner.includes('shell: true')) findings.push('shell runner must be guarded by exact command policy');
const sonar = await readFile('scripts/sonar-gate.mjs', 'utf8');
if (sonar.includes('-Dsonar.token=')) findings.push('Sonar token must not be exposed in process arguments');

for (const name of await readdir('.claude/agents')) {
  const text = await readFile(`.claude/agents/${name}`, 'utf8');
  const isWriter = name === 'forgeai-writer.md';
  if (!isWriter && /tools:.*(?:Edit|Write)/u.test(text)) findings.push(`read-only profile exposes write tools: ${name}`);
  if (!isWriter && !/disallowedTools:.*Edit.*Write/u.test(text) && name !== 'forgeai-orchestrator.md') findings.push(`read-only profile lacks explicit write deny: ${name}`);
  if (/allow_nested_agents:\s*true/u.test(text)) findings.push(`nested agents enabled: ${name}`);
}
const settings = JSON.parse(await readFile('.claude/settings.fragment.json', 'utf8'));
for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
  for (const entry of entries) for (const hook of entry.hooks ?? []) {
    if (!hook.command?.includes('forgeai-hook.mjs')) findings.push(`hook ${event} bypasses ForgeAI entrypoint`);
  }
}

const manifest = JSON.parse(await readFile('SOURCE_MANIFEST.json', 'utf8'));
const secretPaths = manifest.files.map((item) => item.path).filter((path) =>
  !path.startsWith('tests/') && !path.startsWith('examples/') && path !== 'src/secret-scan.mjs' && path !== 'scripts/security-audit.mjs'
);
const secretResult = await scanSecrets('.', { paths: secretPaths });
for (const finding of secretResult.findings) findings.push(`secret pattern ${finding.code} at ${finding.path}:${finding.line}`);

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`security audit PASS (${productionFiles.length} production files, ${secretResult.files_scanned} secret-scanned files)\n`);
