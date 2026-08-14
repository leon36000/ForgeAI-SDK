import { assertSafeText } from './utils.mjs';

const MAX_COMMAND_LENGTH = 4096;
const BARE_SHELL_META = new Set([';', '|', '&', '<', '>', '`']);
const WHITESPACE = /\s/u;
const SAFE_BARE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/u;

export function parseCommandLine(value) {
  const source = assertSafeText(value, 'command');
  if (source.length > MAX_COMMAND_LENGTH) throw new Error(`command is too long; maximum is ${MAX_COMMAND_LENGTH} characters`);
  const args = [];
  let current = '';
  let state = 'bare';
  let started = false;
  const finish = () => {
    if (!started) return;
    args.push(current);
    current = '';
    started = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (state === 'single') {
      if (char === "'") state = 'bare'; else current += char;
      continue;
    }
    if (state === 'double') {
      if (char === '"') state = 'bare';
      else if (char === '\\') {
        index += 1;
        if (index >= source.length) throw new Error('command has a dangling escape');
        current += source[index];
      } else current += char;
      continue;
    }
    if (WHITESPACE.test(char)) { finish(); continue; }
    if (BARE_SHELL_META.has(char)) throw new Error(`shell syntax is forbidden: ${char}`);
    if (char === "'") { state = 'single'; started = true; continue; }
    if (char === '"') { state = 'double'; started = true; continue; }
    if (char === '\\') {
      index += 1;
      if (index >= source.length) throw new Error('command has a dangling escape');
      current += source[index];
      started = true;
      continue;
    }
    current += char;
    started = true;
  }
  if (state !== 'bare') throw new Error('command has an unterminated quote');
  finish();
  if (args.length === 0 || args[0].length === 0) throw new Error('command executable is required');
  return Object.freeze(args);
}

function renderArgument(argument) {
  if (argument.length > 0 && SAFE_BARE_ARGUMENT.test(argument)) return argument;
  return `"${argument.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function canonicalCommand(value) {
  return parseCommandLine(value).map(renderArgument).join(' ');
}

export function commandIdentity(value) {
  return JSON.stringify(parseCommandLine(value));
}

export const COMMAND_LIMITS = Object.freeze({ max_length: MAX_COMMAND_LENGTH });
