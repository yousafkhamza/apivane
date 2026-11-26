// Read/write .apivane/ YAML files. Every path is resolved and must stay inside the collection folder.
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 1024 * 1024;

export class PathError extends Error {
  constructor(message) { super(message); this.kind = 'path'; }
}

/** Resolve a relative collection path safely. Throws on absolute paths, "..", drive letters or non-YAML files. */
export function safePath(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new PathError('Empty or invalid path');
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').some((p) => p === '..' || p === '')) throw new PathError(`Path not allowed: ${rel}`);
  if (!/\.ya?ml$/i.test(norm)) throw new PathError(`Only .yaml files can be written: ${rel}`);
  const base = path.resolve(root);
  const full = path.resolve(base, norm);
  if (full !== base && !full.startsWith(base + path.sep)) throw new PathError(`Path escapes the collection folder: ${rel}`);
  return full;
}

export async function readCollection(root) {
  const base = path.resolve(root);
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && /\.ya?ml$/i.test(e.name)) {
        if (out.length >= MAX_FILES) throw new PathError(`More than ${MAX_FILES} files in ${root}`);
        const st = await fs.stat(full);
        if (st.size > MAX_FILE_BYTES) continue;
        out.push({ path: path.relative(base, full).split(path.sep).join('/'), content: await fs.readFile(full, 'utf8') });
      }
    }
  }
  await walk(base);
  return out;
}

/** Writes files; returns { written, stale } where stale = existing YAML files not in this set (left untouched). */
export async function writeCollection(root, files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new PathError('files must be an array (max 2000)');
  const targets = files.map((f) => {
    if (typeof f?.content !== 'string' || Buffer.byteLength(f.content) > MAX_FILE_BYTES) throw new PathError(`File too large or missing content: ${f?.path}`);
    return { full: safePath(root, f.path), rel: f.path.replace(/\\/g, '/'), content: f.content };
  });
  for (const t of targets) {
    await fs.mkdir(path.dirname(t.full), { recursive: true });
    await fs.writeFile(t.full, t.content, 'utf8');
  }
  const wanted = new Set(targets.map((t) => t.rel));
  const existing = await readCollection(root);
  return { written: targets.length, stale: existing.map((f) => f.path).filter((p) => !wanted.has(p)) };
}
