// Build everything with plain Node (no dependencies):
//   dist/            GitHub Pages site (web UI + core modules + service worker + SEO files)
//   packages/cli/web, packages/cli/core   bundled into the npm package
//   dist-ext/        Chrome/Edge + Firefox extension folders and .zip files
// Env: SITE_URL (default https://yousafkhamza.github.io/apivane/)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...p) => path.join(root, ...p);
const pkg = JSON.parse(fs.readFileSync(P('package.json'), 'utf8'));
let SITE_URL = (process.env.SITE_URL || 'https://yousafkhamza.github.io/apivane/').trim();
if (!/^https?:\/\/[^\s"'<>]+$/.test(SITE_URL)) throw new Error(`SITE_URL is not a valid URL: ${SITE_URL}`);
if (!SITE_URL.endsWith('/')) SITE_URL += '/';

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
function list(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? list(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

// ---------- web ----------
const dist = P('dist');
rm(dist);
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'theme.js', 'styles.css', 'manifest.webmanifest']) fs.copyFileSync(P('packages/web', f), path.join(dist, f));
copyDir(P('packages/web/src'), path.join(dist, 'src'));
copyDir(P('packages/web/icons'), path.join(dist, 'icons'));
copyDir(P('packages/core/src'), path.join(dist, 'core'));

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replaceAll('%SITE_URL%', SITE_URL);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
fs.writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}</loc></url></urlset>\n`);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// Service worker: precache the app shell; version = hash of every file so each deploy refreshes caches.
const shell = list(dist).filter((f) => !f.startsWith('.') && f !== 'og.png' && !f.endsWith('og.png') && f !== 'robots.txt' && f !== 'sitemap.xml');
const hash = crypto.createHash('sha256');
for (const f of shell) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
const sw = fs.readFileSync(P('packages/web/sw.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('__FILES__', JSON.stringify(['./', ...shell.map((f) => './' + f)]));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

// ---------- cli package: bundle core + web ----------
rm(P('packages/cli/core'));
rm(P('packages/cli/web'));
copyDir(P('packages/core/src'), P('packages/cli/core'));
copyDir(dist, P('packages/cli/web'));
rm(P('packages/cli/web/sw.js')); // the agent never registers a service worker
fs.copyFileSync(P('LICENSE'), P('packages/cli/LICENSE'));

// ---------- browser extension ----------
const appUrl = SITE_URL;
// The extension answers ONLY the ApiVane app URL (not any localhost page). For local extension testing,
// build with SITE_URL=http://127.0.0.1:4173/ . Match patterns can't carry a port, so the content script
// matches the host+path and the background checks the exact URL prefix (with port).
const site = new URL(appUrl);
const matches = [`${site.protocol}//${site.hostname}${site.pathname}*`];
const prefixes = [appUrl];
const base = {
  manifest_version: 3,
  name: 'ApiVane',
  version: pkg.version,
  description: 'Lets the ApiVane web app send API requests without browser CORS limits. Works only on the ApiVane app.',
  homepage_url: appUrl,
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_title: 'Open ApiVane', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  host_permissions: ['<all_urls>'],
  content_scripts: [{ matches, js: ['content.js'], run_at: 'document_start', all_frames: false }],
};
const targets = {
  chrome: { ...base, minimum_chrome_version: '116', background: { service_worker: 'background.js' } },
  firefox: { ...base, background: { scripts: ['background.js'] },
    browser_specific_settings: { gecko: { id: 'apivane@yousafkhamza.github.io', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } } } },
};
const extOut = P('dist-ext');
rm(extOut);
const bg = fs.readFileSync(P('packages/extension/src/background.js'), 'utf8')
  .replace("'__APP_URL__'", JSON.stringify(appUrl)).replace('__ALLOWED__', JSON.stringify(prefixes));
for (const [name, manifest] of Object.entries(targets)) {
  const dir = path.join(extOut, name);
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'background.js'), bg);
  fs.copyFileSync(P('packages/extension/src/content.js'), path.join(dir, 'content.js'));
  copyDir(P('packages/extension/icons'), path.join(dir, 'icons'));
  const files = list(dir).map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
  fs.writeFileSync(path.join(extOut, `apivane-${name}-${pkg.version}.zip`), zip(files));
}

console.log(`Built ${shell.length} site files (sw ${version}) for ${SITE_URL}, cli bundle, and extensions in dist-ext/`);
