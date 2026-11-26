// Minimal YAML subset used for .apivane/ files: block mappings and sequences (2-space indent),
// plain / "double" / 'single' quoted scalars, numbers, booleans, null, `|` and `|-` block strings,
// and single-line JSON flow values ({...} / [...]). Enough to diff cleanly in git, zero dependencies.

const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const PLAIN = /^[A-Za-z_/][\w./@()+;=?&%~-]*( [\w./@()+;=?&%~-]+)*$/;

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) ? s : JSON.stringify(s);
}
const key = (k) => (/^[A-Za-z_][\w.-]*$/.test(k) && !RESERVED.test(k) ? k : JSON.stringify(k));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function emitValue(k, v, pad, out) {
  const head = `${pad}${key(k)}:`;
  if (Array.isArray(v)) {
    if (!v.length) return out.push(`${head} []`);
    out.push(head);
    emitSeq(v, pad + '  ', out);
  } else if (isObj(v)) {
    if (!Object.keys(v).length) return out.push(`${head} {}`);
    out.push(head);
    emitMap(v, pad + '  ', out);
  } else if (typeof v === 'string' && v.includes('\n') && !/^[ \t]/.test(v)) {
    const ends = v.endsWith('\n');
    const lines = (ends ? v.slice(0, -1) : v).split('\n');
    out.push(`${head} ${ends ? '|' : '|-'}`);
    for (const l of lines) out.push(l ? pad + '  ' + l : '');
  } else out.push(`${head} ${scalar(v)}`);
}
function emitMap(o, pad, out) {
  for (const [k, v] of Object.entries(o)) if (v !== undefined) emitValue(k, v, pad, out);
}
function emitSeq(a, pad, out) {
  for (const item of a) {
    if (isObj(item) && Object.keys(item).length) {
      const sub = [];
      emitMap(item, pad + '  ', sub);
      sub[0] = pad + '- ' + sub[0].slice(pad.length + 2);
      out.push(...sub);
    } else if (Array.isArray(item) || isObj(item)) out.push(`${pad}- ${JSON.stringify(item)}`);
    else out.push(`${pad}- ${scalar(item)}`);
  }
}

/** @param {unknown} value */
export function stringify(value) {
  const out = [];
  if (Array.isArray(value)) emitSeq(value, '', out);
  else if (isObj(value)) emitMap(value, '', out);
  else out.push(scalar(value));
  return out.join('\n') + '\n';
}

// ---------------- parser ----------------
class YamlError extends Error {
  constructor(msg, line) {
    super(`YAML line ${line + 1}: ${msg}`);
    this.line = line + 1;
  }
}

function stripComment(s) {
  const i = s.search(/(^|\s)#/);
  return (i < 0 ? s : s.slice(0, i)).trim();
}
function readQuoted(s, ln) {
  if (s[0] === '"') {
    let i = 1;
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
    if (i >= s.length) throw new YamlError('unclosed "', ln);
    return [JSON.parse(s.slice(0, i + 1)), s.slice(i + 1)];
  }
  let i = 1, v = '';
  for (;;) {
    if (i >= s.length) throw new YamlError("unclosed '", ln);
    if (s[i] === "'") {
      if (s[i + 1] === "'") { v += "'"; i += 2; continue; }
      return [v, s.slice(i + 1)];
    }
    v += s[i++];
  }
}
function parseScalar(raw, ln) {
  const s = raw.trim();
  if (!s) return null;
  if (s[0] === '"' || s[0] === "'") {
    const [v, rest] = readQuoted(s, ln);
    if (stripComment(rest)) throw new YamlError('unexpected text after quoted string', ln);
    return v;
  }
  if (s[0] === '{' || s[0] === '[') {
    try { return JSON.parse(stripComment(s)); } catch { throw new YamlError('flow value must be valid JSON', ln); }
  }
  const p = stripComment(s);
  if (/^(null|~)$/.test(p)) return null;
  if (p === 'true') return true;
  if (p === 'false') return false;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(p)) return Number(p);
  return p;
}
function splitKey(c, ln) {
  if (c[0] === '"' || c[0] === "'") {
    const [k, rest] = readQuoted(c, ln);
    const m = rest.match(/^\s*:(\s|$)/);
    if (!m) throw new YamlError('expected ":" after key', ln);
    return [k, rest.slice(m[0].length)];
  }
  const i = c.search(/:(\s|$)/);
  if (i < 0) throw new YamlError(`expected "key: value", got "${c}"`, ln);
  return [c.slice(0, i).trim(), c.slice(i + 1)];
}
const MAP_START = /^("(?:\\.|[^"])*"|'(?:''|[^'])*'|[^"'{[\s#][^:#]*?)\s*:(\s|$)/;

/** @param {string} text */
export function parse(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  const sig = () => {
    while (i < lines.length && (!lines[i].trim() || lines[i].trimStart().startsWith('#'))) i++;
    if (i < lines.length && /^\s*\t/.test(lines[i])) throw new YamlError('tabs are not allowed for indentation', i);
    return i < lines.length;
  };
  const isItem = (l) => /^-(\s|$)/.test(l.trimStart());

  function node(min) {
    if (!sig() || indentOf(lines[i]) < min) return null;
    return isItem(lines[i]) ? seq(indentOf(lines[i])) : map(indentOf(lines[i]));
  }
  function block(ind, keep) {
    const buf = [];
    let bi = -1;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() && indentOf(l) <= ind) break;
      if (l.trim() && bi < 0) bi = indentOf(l);
      buf.push(l.trim() ? l.slice(bi) : '');
      i++;
    }
    while (buf.length && !buf[buf.length - 1]) buf.pop();
    return buf.join('\n') + (keep && buf.length ? '\n' : '');
  }
  function value(rest, ind, ln) {
    const r = stripComment(rest);
    if (r === '|' || r === '|-') return block(ind, r === '|');
    if (r) return parseScalar(rest, ln);
    if (!sig()) return null;
    const ni = indentOf(lines[i]);
    if (ni > ind || (ni === ind && isItem(lines[i]))) return node(ni);
    return null;
  }
  function map(ind) {
    const o = {};
    while (sig()) {
      const l = lines[i], d = indentOf(l);
      if (d < ind || (d === ind && isItem(l))) break;
      if (d > ind) throw new YamlError('bad indentation', i);
      const ln = i;
      const [k, rest] = splitKey(l.trim(), ln);
      i++;
      o[k] = value(rest, ind, ln);
    }
    return o;
  }
  function seq(ind) {
    const a = [];
    while (sig()) {
      const l = lines[i], d = indentOf(l);
      if (d < ind || !isItem(l) || d > ind) {
        if (d > ind) throw new YamlError('bad indentation', i);
        break;
      }
      const rest = l.slice(d + 1);
      const body = rest.trimStart();
      if (!body || body.startsWith('#')) { i++; a.push(node(ind + 1)); continue; }
      if (MAP_START.test(body)) {
        lines[i] = ' '.repeat(d + 1 + rest.length - body.length) + body;
        a.push(map(indentOf(lines[i])));
      } else { const ln = i; i++; a.push(parseScalar(body, ln)); }
    }
    return a;
  }
  if (!sig()) return null;
  const first = lines[i].trim();
  if (indentOf(lines[i]) === 0 && !isItem(lines[i]) && !MAP_START.test(first)) {
    const v = parseScalar(first, i); i++;
    if (sig()) throw new YamlError('unexpected content', i);
    return v;
  }
  const out = node(0);
  if (sig()) throw new YamlError('unexpected content', i);
  return out;
}
