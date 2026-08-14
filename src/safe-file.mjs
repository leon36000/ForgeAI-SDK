import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const NO_FOLLOW = constants.O_NOFOLLOW;
const SECURE_NO_FOLLOW_AVAILABLE = Number.isInteger(NO_FOLLOW);
const READ_FLAGS = SECURE_NO_FOLLOW_AVAILABLE ? constants.O_RDONLY | NO_FOLLOW : null;

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function stableFileError(path, reason) {
  const error = new Error(`${path}: ${reason}`);
  error.code = 'UNSTABLE_FILE';
  return error;
}

export async function readStableRegularFile(path, { maxBytes = Number.MAX_SAFE_INTEGER, _beforeOpen, _beforeRead } = {}) {
  if (!SECURE_NO_FOLLOW_AVAILABLE) {
    const error = new Error('secure no-follow file opens are unavailable on this platform');
    error.code = 'UNSUPPORTED_SECURE_OPEN';
    throw error;
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer');
  if (_beforeOpen) await _beforeOpen();
  let handle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (error.code === 'ELOOP') throw stableFileError(path, 'symbolic link refused during secure open');
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw stableFileError(path, 'not a regular file');
    const pathBeforeRead = await lstat(path, { bigint: true });
    if (pathBeforeRead.isSymbolicLink() || !sameIdentity(opened, pathBeforeRead)) {
      throw stableFileError(path, 'path changed during secure open');
    }
    if (opened.size > BigInt(maxBytes)) throw stableFileError(path, `file exceeds maximum size of ${maxBytes} bytes`);
    if (_beforeRead) await _beforeRead();
    const beforeRead = await handle.stat({ bigint: true });
    if (!sameSnapshot(opened, beforeRead)) throw stableFileError(path, 'changed during secure read');
    const bytes = await handle.readFile();
    const [afterRead, pathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      pathAfterRead.isSymbolicLink()
      || !sameIdentity(afterRead, pathAfterRead)
      || !sameSnapshot(beforeRead, afterRead)
      || BigInt(bytes.length) !== afterRead.size
    ) throw stableFileError(path, 'changed during secure read');
    return Object.freeze({ bytes, size: Number(afterRead.size), stat: afterRead });
  } finally {
    await handle.close();
  }
}

export const SAFE_FILE_CAPABILITIES = Object.freeze({ secure_no_follow: SECURE_NO_FOLLOW_AVAILABLE });
