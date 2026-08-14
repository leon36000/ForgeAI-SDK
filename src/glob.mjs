import { assertSafeText } from './utils.mjs';

const MAX_GLOB_PATTERN_LENGTH = 512;
const MAX_GLOB_PATH_LENGTH = 4096;
const TOKEN = Object.freeze({ LITERAL: 0, QUESTION: 1, STAR: 2, GLOBSTAR: 3, GLOBSTAR_SLASH: 4 });

export function toPosixPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
}

export function validateGlobPattern(pattern) {
  const source = toPosixPath(assertSafeText(pattern, 'glob'));
  if (source.length > MAX_GLOB_PATTERN_LENGTH) throw new Error(`glob is too long; maximum is ${MAX_GLOB_PATTERN_LENGTH} characters`);
  return source;
}

function tokenizeGlob(pattern) {
  const source = validateGlobPattern(pattern);
  const tokens = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '*') { tokens.push(char === '?' ? [TOKEN.QUESTION] : [TOKEN.LITERAL, char]); continue; }
    if (source[index + 1] !== '*') { tokens.push([TOKEN.STAR]); continue; }
    index += 1;
    if (source[index + 1] === '/') { index += 1; tokens.push([TOKEN.GLOBSTAR_SLASH]); }
    else tokens.push([TOKEN.GLOBSTAR]);
  }
  return tokens;
}

function matchesTokens(path, tokens) {
  const width = path.length + 1;
  const visited = new Uint8Array((tokens.length + 1) * width);
  const stack = [0];
  visited[0] = 1;
  const push = (tokenIndex, pathIndex) => {
    const state = tokenIndex * width + pathIndex;
    if (visited[state]) return;
    visited[state] = 1;
    stack.push(state);
  };
  while (stack.length > 0) {
    const state = stack.pop();
    const tokenIndex = Math.floor(state / width);
    const pathIndex = state % width;
    if (tokenIndex === tokens.length) { if (pathIndex === path.length) return true; continue; }
    const [kind, literal] = tokens[tokenIndex];
    if (kind === TOKEN.GLOBSTAR_SLASH) {
      push(tokenIndex + 1, pathIndex);
      if (pathIndex < path.length) { push(tokenIndex, pathIndex + 1); if (path[pathIndex] === '/') push(tokenIndex + 1, pathIndex + 1); }
      continue;
    }
    if (kind === TOKEN.GLOBSTAR) { push(tokenIndex + 1, pathIndex); if (pathIndex < path.length) push(tokenIndex, pathIndex + 1); continue; }
    if (kind === TOKEN.STAR) { push(tokenIndex + 1, pathIndex); if (pathIndex < path.length && path[pathIndex] !== '/') push(tokenIndex, pathIndex + 1); continue; }
    if (pathIndex >= path.length) continue;
    if (kind === TOKEN.QUESTION) { if (path[pathIndex] !== '/') push(tokenIndex + 1, pathIndex + 1); continue; }
    if (path[pathIndex] === literal) push(tokenIndex + 1, pathIndex + 1);
  }
  return false;
}

export function matchesGlob(pathValue, pattern) {
  const path = toPosixPath(assertSafeText(pathValue, 'path'));
  if (path.length > MAX_GLOB_PATH_LENGTH) throw new Error(`path is too long; maximum is ${MAX_GLOB_PATH_LENGTH} characters`);
  return matchesTokens(path, tokenizeGlob(pattern));
}

export function matchesAny(path, patterns) {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

export const GLOB_LIMITS = Object.freeze({ max_pattern_length: MAX_GLOB_PATTERN_LENGTH, max_path_length: MAX_GLOB_PATH_LENGTH });
