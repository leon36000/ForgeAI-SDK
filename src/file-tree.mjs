import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toPosixPath } from './glob.mjs';

const DEFAULT_MAX_FILES = 100_000;

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function sameSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function directorySnapshot(rootPhysical, cursor) {
  const [stat, physical] = await Promise.all([lstat(cursor, { bigint: true }), realpath(cursor)]);
  if (stat.isSymbolicLink()) throw new Error(`symbolic link forbidden: ${cursor}`);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${cursor}`);
  if (!isInside(rootPhysical, physical)) throw new Error(`directory escapes root: ${cursor}`);
  return Object.freeze({ physical, stat });
}

export async function collectRegularFiles(rootValue, { exclude = () => false, include = () => true, maxFiles = DEFAULT_MAX_FILES, _afterReadDirectory } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error('maxFiles must be a positive safe integer');
  const root = resolve(rootValue);
  const rootPhysical = await realpath(root);
  const rootInfo = await lstat(root, { bigint: true });
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`inventory root must be a real directory: ${root}`);
  const files = [];
  async function walk(cursor) {
    const before = await directorySnapshot(rootPhysical, cursor);
    const entries = await readdir(cursor, { withFileTypes: true });
    if (_afterReadDirectory) await _afterReadDirectory(cursor);
    const afterRead = await directorySnapshot(rootPhysical, cursor);
    if (before.physical !== afterRead.physical || !sameSnapshot(before.stat, afterRead.stat)) throw new Error(`directory changed during enumeration: ${cursor}`);
    for (const entry of entries) {
      const absolute = join(cursor, entry.name);
      const rel = toPosixPath(relative(root, absolute));
      if (exclude(rel)) continue;
      const current = await lstat(absolute, { bigint: true });
      if (current.isSymbolicLink()) throw new Error(`symbolic link forbidden: ${rel}`);
      if (current.isDirectory()) { await walk(absolute); continue; }
      if (!current.isFile()) throw new Error(`unsupported filesystem entry: ${rel}`);
      if (!include(rel)) continue;
      files.push(Object.freeze({ absolute, relative: rel }));
      if (files.length > maxFiles) throw new Error(`file inventory exceeds maximum ${maxFiles}`);
    }
    const afterWalk = await directorySnapshot(rootPhysical, cursor);
    if (before.physical !== afterWalk.physical || !sameSnapshot(before.stat, afterWalk.stat)) throw new Error(`directory changed during enumeration: ${cursor}`);
  }
  await walk(root);
  return Object.freeze(files.sort((a, b) => a.relative.localeCompare(b.relative)));
}

export const FILE_TREE_LIMITS = Object.freeze({ max_files: DEFAULT_MAX_FILES });
