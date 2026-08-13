import { assertSafeText } from './utils.mjs';

export function toPosixPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
}

function escapeRegex(char) {
  return /[\\^$.*+?()[\]{}|]/u.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern) {
  const source = toPosixPath(assertSafeText(pattern, 'glob'));
  let out = '^';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '*') {
      if (source[index + 1] === '*') {
        index += 1;
        if (source[index + 1] === '/') {
          index += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(char);
    }
  }
  out += '$';
  return new RegExp(out, 'u');
}

export function matchesGlob(path, pattern) {
  return globToRegExp(pattern).test(toPosixPath(path));
}

export function matchesAny(path, patterns) {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}
