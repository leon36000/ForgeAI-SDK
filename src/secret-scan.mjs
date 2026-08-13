import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { toPosixPath } from './glob.mjs';

const RULES = Object.freeze([
  { id: 'PRIVATE_KEY', severity: 'critical', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u },
  { id: 'AWS_ACCESS_KEY', severity: 'high', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { id: 'GITHUB_TOKEN', severity: 'high', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u },
  { id: 'ANTHROPIC_KEY', severity: 'high', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/u },
  { id: 'OPENAI_KEY', severity: 'high', pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { id: 'GENERIC_SECRET_ASSIGNMENT', severity: 'medium', pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\n]{12,}['"]/iu },
]);
const BINARY_RE = /\.(?:png|jpe?g|gif|webp|pdf|zip|gz|tar|woff2?|ttf|ico|lock)$/iu;
const EXCLUDED = ['.git', 'node_modules', '.forgeai', '.scannerwork'];

async function collect(root, cursor, out) {
  for (const entry of await readdir(cursor, { withFileTypes: true })) {
    const absolute = join(cursor, entry.name);
    const rel = toPosixPath(relative(root, absolute));
    if (EXCLUDED.some((item) => rel === item || rel.startsWith(`${item}/`))) continue;
    if (entry.isDirectory()) await collect(root, absolute, out);
    else if (entry.isFile() && !BINARY_RE.test(rel)) out.push({ absolute, relative: rel });
  }
}

export async function scanSecrets(workspaceValue, { paths = [] } = {}) {
  const workspace = resolve(workspaceValue);
  const files = [];
  await collect(workspace, workspace, files);
  const allowed = paths.length === 0 ? files : files.filter((file) => paths.includes(file.relative));
  const findings = [];
  for (const file of allowed) {
    const bytes = await readFile(file.absolute);
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push({ code: rule.id, severity: rule.severity, status: 'OPEN', path: file.relative, line });
      }
    }
  }
  return Object.freeze({ status: findings.length === 0 ? 'PASS' : 'FAIL', findings, files_scanned: allowed.length });
}
