import { cp, mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const target = resolve(args.find((item) => !item.startsWith('--')) ?? '.');
const apply = args.includes('--apply');
const force = args.includes('--force');
const root = resolve(new URL('..', import.meta.url).pathname);
const git = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (git.status !== 0 || resolve(git.stdout.trim()) !== target) throw new Error('target must be a Git repository root');
if (target === root || target.startsWith(`${root}/`)) throw new Error('refusing to install Foundation into itself');
const destination = join(target, '.forgeai', 'foundation');
const agentsDestination = join(target, '.claude', 'agents');
const hooksDestination = join(target, '.claude', 'hooks');
const planned = { target, destination, copy_agents: true, merge_hooks: true };
if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: 'DRY_RUN', ...planned }, null, 2)}\n`);
  process.exit(0);
}
try { await access(destination); if (!force) throw new Error('Foundation already exists; use --force to replace it'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(join(target, '.forgeai'), { recursive: true });
await mkdir(destination, { recursive: true });
for (const entry of ['src', 'bin', 'config', 'schemas', 'package.json', 'README.md']) {
  await cp(join(root, entry), join(destination, entry), { recursive: true, force });
}
await mkdir(agentsDestination, { recursive: true });
await mkdir(hooksDestination, { recursive: true });
for (const name of await readdir(join(root, '.claude', 'agents'))) {
  const source = join(root, '.claude', 'agents', name);
  const destinationAgent = join(agentsDestination, name);
  try { await access(destinationAgent); throw new Error(`agent profile already exists: ${name}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await cp(source, destinationAgent, { force: false, errorOnExist: true });
}
await cp(join(root, '.claude', 'hooks', 'forgeai-hook.mjs'), join(hooksDestination, 'forgeai-hook.mjs'), { force: true });
const fragment = JSON.parse(await readFile(join(root, '.claude', 'settings.fragment.json'), 'utf8'));
const settingsPath = join(target, '.claude', 'settings.json');
let settings = {};
try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
settings.hooks ??= {};
for (const [event, entries] of Object.entries(fragment.hooks)) {
  const existing = settings.hooks[event] ?? [];
  const signatures = new Set(existing.flatMap((entry) => (entry.hooks ?? []).map((hook) => hook.command)));
  settings.hooks[event] = [...existing, ...entries.filter((entry) => !(entry.hooks ?? []).some((hook) => signatures.has(hook.command)))];
}
await mkdir(join(target, '.claude'), { recursive: true });
await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
const gitignorePath = join(target, '.gitignore');
let gitignore = '';
try { gitignore = await readFile(gitignorePath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const ignoreEntries = ['.forgeai/runtime/', '.forgeai/worktrees/', '.forgeai/ledger/', '.forgeai/evidence/', '.scannerwork/'];
for (const entry of ignoreEntries) if (!gitignore.split(/\r?\n/u).includes(entry)) gitignore += `${gitignore.endsWith('\n') || gitignore.length === 0 ? '' : '\n'}${entry}\n`;
await writeFile(gitignorePath, gitignore, 'utf8');
process.stdout.write(`${JSON.stringify({ mode: 'APPLIED', ...planned }, null, 2)}\n`);
