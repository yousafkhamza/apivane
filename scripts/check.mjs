// Static checks on the built output — catches broken imports, missing files and CSP mistakes before deploy.
// Run after `npm run build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const errors = [];
const err = (m) => errors.push(m);
const read = (f) => fs.readFileSync(f, 'utf8');
function list(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
if (!fs.existsSync(dist)) { console.error('dist/ missing — run npm run build first'); process.exit(1); }

// 1. index.html: CSP, no leftovers, no external scripts, every local reference exists
const html = read(path.join(dist, 'index.html'));
if (!html.includes('Content-Security-Policy')) err('index.html: CSP meta tag missing');
if (html.includes('%SITE_URL%')) err('index.html: %SITE_URL% placeholder not replaced');
if (/<script(?![^>]*type="application\/ld\+json")(?![^>]*\ssrc=)[^>]*>/.test(html)) err('index.html: inline <script> found (blocked by CSP)');
if (/<script[^>]+src="https?:/.test(html) || /<link[^>]+rel="stylesheet"[^>]+href="https?:/.test(html)) err('index.html: external script/style found');
if (!html.includes('By <a href="https://github.com/yousafkhamza"')) err('index.html: author credit missing');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
  if (/^(https?:|mailto:|data:|%)/.test(ref)) continue;
  if (!fs.existsSync(path.join(dist, ref))) err(`index.html references missing file: ${ref}`);
}
try { JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); } catch { err('index.html: JSON-LD is not valid JSON'); }

// 2. every ES module import resolves, and named imports exist in the target module
const jsFiles = [...list(dist), ...list(path.join(root, 'packages/cli/src')), ...list(path.join(root, 'packages/cli/bin'))].filter((f) => f.endsWith('.js'));
const exportsCache = new Map();
function exportsOf(file, seen = new Set()) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = read(file), names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) for (const n of m[1].split(',')) { const p = n.trim().split(/\s+as\s+/); if (p[0]) names.add((p[1] || p[0]).trim()); }
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const t = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(t)) for (const n of exportsOf(t, seen)) names.add(n);
  }
  exportsCache.set(file, names);
  return names;
}
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(/import\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?(?:\*\s*as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g)) {
    const [, def, named, spec] = m;
    if (spec.startsWith('node:')) continue;
    if (!spec.startsWith('.')) { err(`${path.relative(root, f)}: bare import "${spec}" (no dependencies allowed)`); continue; }
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) { err(`${path.relative(root, f)}: import "${spec}" not found`); continue; }
    const ex = exportsOf(target);
    if (def && !ex.has('default') && !/export\s+default/.test(read(target))) err(`${path.relative(root, f)}: no default export in ${spec}`);
    for (const n of (named || '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(n)) err(`${path.relative(root, f)}: "${n}" is not exported by ${spec}`);
    }
  }
}

// 3. syntax check every JS file as an ES module
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apivane-check-'));
for (const f of jsFiles) {
  const copy = path.join(tmp, path.basename(f).replace(/\.js$/, '') + '-' + Math.random().toString(36).slice(2) + '.mjs');
  fs.writeFileSync(copy, read(f).replace(/^#!.*\n/, '\n'));
  const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
  if (r.status !== 0) err(`${path.relative(root, f)}: syntax error\n${r.stderr.split('\n').slice(0, 6).join('\n')}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

// 4. PWA manifest + service worker file list
const man = JSON.parse(read(path.join(dist, 'manifest.webmanifest')));
for (const i of man.icons) if (!fs.existsSync(path.join(dist, i.src))) err(`manifest icon missing: ${i.src}`);
if (!man.icons.some((i) => i.sizes === '512x512') || !man.icons.some((i) => i.sizes === '192x192')) err('manifest needs 192 and 512 icons');
const sw = read(path.join(dist, 'sw.js'));
if (sw.includes('__FILES__') || sw.includes('__VERSION__')) err('sw.js placeholders not replaced');
const files = JSON.parse(sw.match(/const FILES = (\[.*?\]);/s)[1]);
for (const f of files) if (f !== './' && !fs.existsSync(path.join(dist, f))) err(`sw.js precaches missing file: ${f}`);

// 5. extensions
const pkg = JSON.parse(read(path.join(root, 'package.json')));
const cliPkg = JSON.parse(read(path.join(root, 'packages/cli/package.json')));
if (pkg.version !== cliPkg.version) err(`version mismatch: root ${pkg.version} vs cli ${cliPkg.version}`);
for (const t of ['chrome', 'firefox']) {
  const dir = path.join(root, 'dist-ext', t);
  const m = JSON.parse(read(path.join(dir, 'manifest.json')));
  if (m.version !== pkg.version) err(`${t} extension version ${m.version} != ${pkg.version}`);
  for (const f of [...Object.values(m.icons), ...m.content_scripts.flatMap((c) => c.js), ...(m.background.scripts || [m.background.service_worker])]) if (!fs.existsSync(path.join(dir, f))) err(`${t} extension missing ${f}`);
  const bg = read(path.join(dir, 'background.js'));
  if (bg.includes('__ALLOWED__') || bg.includes('__APP_URL__')) err(`${t} background.js placeholders not replaced`);
  if (!fs.existsSync(path.join(root, 'dist-ext', `apivane-${t}-${pkg.version}.zip`))) err(`${t} zip missing`);
}

if (errors.length) { console.error(`✗ ${errors.length} problem(s):\n- ` + errors.join('\n- ')); process.exit(1); }
console.log(`✓ checks passed (${jsFiles.length} JS files, ${files.length} precached files)`);
