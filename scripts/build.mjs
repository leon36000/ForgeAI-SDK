import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function collect(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, out);
    else if (entry.isFile() && path.endsWith('.mjs')) out.push(path);
  }
  return out;
}

const files = [];
for (const directory of ['src', 'bin', 'scripts', '.claude/hooks']) {
  files.push(...await collect(directory));
}
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(`syntax-check PASS (${files.length} files)\n`);
