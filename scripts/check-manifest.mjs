import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('SOURCE_MANIFEST.json', 'utf8'));
const findings = [];
for (const file of manifest.files) {
  try {
    const bytes = await readFile(file.path);
    const info = await stat(file.path);
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
