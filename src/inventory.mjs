import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from './utils.mjs';
import { toPosixPath } from './glob.mjs';

const EXCLUDED = new Set(['.git', 'node_modules', '.forgeai/worktrees', '.scannerwork']);

async function walk(root, cursor, files) {
  for (const entry of await readdir(cursor, { withFileTypes: true })) {
    const absolute = join(cursor, entry.name);
    const rel = toPosixPath(relative(root, absolute));
    if ([...EXCLUDED].some((item) => rel === item || rel.startsWith(`${item}/`))) continue;
    if (entry.isDirectory()) await walk(root, absolute, files);
    else if (entry.isFile()) {
      const info = await stat(absolute);
      const bytes = await readFile(absolute);
      files.push({ path: rel, bytes: info.size, sha256: sha256(bytes) });
    }
  }
}

function version(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : null;
}

export async function inventoryRepository(workspaceValue) {
  const workspace = resolve(workspaceValue);
  const files = [];
  await walk(workspace, workspace, files);
  return Object.freeze({
    schema_version: 'forgeai.inventory.v0.1.1',
    generated_at: new Date().toISOString(),
    workspace,
    tools: {
      node: version('node', ['--version']),
      npm: version('npm', ['--version']),
      git: version('git', ['--version']),
      sonar_scanner: version(process.env.SONAR_SCANNER_BIN ?? 'sonar-scanner', ['--version']),
    },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  });
}
