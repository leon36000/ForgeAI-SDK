import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const excludedPrefixes = ['.git/', 'verification/', '.forgeai/', '.scannerwork/'];
const excludedNames = new Set(['SOURCE_MANIFEST.json', 'verification-full.log', 'verification-test.log', 'RELEASE_STATUS', 'TESTS_PASS', 'TESTS_FAIL']);
async function collect(cursor = '.', out = []) {
  for (const entry of await readdir(cursor, { withFileTypes: true })) {
    const path = cursor === '.' ? entry.name : `${cursor}/${entry.name}`;
    if (excludedNames.has(path) || excludedPrefixes.some((prefix) => `${path}/`.startsWith(prefix) || path.startsWith(prefix))) continue;
    if (entry.isDirectory()) await collect(path, out);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      const info = await stat(path);
      out.push({ path, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return out;
}
const files = (await collect()).sort((a, b) => a.path.localeCompare(b.path));
const manifest = { schema_version: 'forgeai.source-manifest.v0.1.1', generated_at: new Date().toISOString(), files };
await writeFile('SOURCE_MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`manifest PASS (${files.length} files)\n`);
