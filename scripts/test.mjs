import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

await rm('.forgeai-test-tmp', { recursive: true, force: true });
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
if (build.status !== 0) process.exit(build.status ?? 1);

async function collect(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, out);
    else if (entry.isFile() && path.endsWith('.test.mjs')) out.push(path);
  }
  return out;
}
const tests = (await collect('tests')).sort();
if (tests.length === 0) throw new Error('no tests found');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
