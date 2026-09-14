'use strict';

/**
 * Minimal glob matcher for fork/slim.json path rules.
 * Supports `**` (any depth, including zero segments), `*` (within a segment),
 * `?` (single char) and `{a,b}` alternation. No extglob, no negation.
 */

function escapeRegex(char) {
  return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}

function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  const close = pattern.indexOf('}', open);
  if (close === -1) return [pattern];
  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  return pattern
    .slice(open + 1, close)
    .split(',')
    .flatMap(option => expandBraces(`${head}${option}${tail}`));
}

function toRegexSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      const slashAfter = pattern[i + 2] === '/';
      source += slashAfter ? '(?:.*/)?' : '.*';
      i += slashAfter ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegex(char);
    }
  }
  return source;
}

function globToRegExp(pattern) {
  const normalized = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
  const alternatives = expandBraces(normalized).map(toRegexSource);
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

function createMatcher(patterns) {
  const regexes = (patterns || []).map(globToRegExp);
  return filePath => {
    const normalized = String(filePath).replace(/\\/g, '/');
    return regexes.some(regex => regex.test(normalized));
  };
}

module.exports = { globToRegExp, createMatcher };
