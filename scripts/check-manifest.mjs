import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';

const excludedPrefixes = ['.git/', 'verification/', '.forgeai/', '.scannerwork/'];
const excludedNames = new Set(['SOURCE_MANIFEST.json', 'verification-full.log', 'verification-test.log', 'RELEASE_STATUS', 'TESTS_PASS', 'TESTS_FAIL']);

function isExcluded(path) {
  return excludedNames.has(path) || excludedPrefixes.some((prefix) => `${path}/`.startsWith(prefix) || path.startsWith(prefix));
}

async function collect(cursor = '.', out = []) {
  for (const entry of await readdir(cursor, { withFileTypes: true })) {
    const path = cursor === '.' ? entry.name : `${cursor}/${entry.name}`;
    if (isExcluded(path)) continue;
    if (entry.isDirectory()) await collect(path, out);
    else out.push(path);
  }
  return out;
}

const manifest = JSON.parse(await readFile('SOURCE_MANIFEST.json', 'utf8'));
if (!Array.isArray(manifest.files)) throw new Error('SOURCE_MANIFEST.json files must be an array');
const findings = [];
const manifestPaths = manifest.files.map((file) => file.path);
const manifestPathSet = new Set(manifestPaths);
if (manifestPathSet.size !== manifestPaths.length) findings.push('manifest contains duplicate paths');
for (const path of (await collect()).sort()) {
  if (!manifestPathSet.has(path)) findings.push(`unlisted file: ${path}`);
}
for (const file of manifest.files) {
  try {
    const info = await lstat(file.path);
    if (!info.isFile()) {
      findings.push(`${file.path}: not a regular file`);
      continue;
    }
    const bytes = await readFile(file.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (info.size !== file.bytes || hash !== file.sha256) findings.push(`${file.path}: hash or size mismatch`);
  } catch (error) {
    findings.push(`${file.path}: ${error.code ?? error.message}`);
  }
}
if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`manifest verification PASS (${manifest.files.length} files)\n`);
