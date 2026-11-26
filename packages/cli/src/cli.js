import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAgent, newToken } from './agent.js';
import { runCollection, exitCode, RunError } from './run.js';
import { cliLine, summaryLine, junit, markdown } from './report.js';
import { writeCollection } from './files.js';
import { workspaceToFiles, newRequest } from '../core/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(here, '..', 'package.json'), 'utf8'));

const HELP = `ApiVane ${pkg.version} — free API client, test runner and security checks

Usage
  apivane [serve]  [--port 7878] [--dir .apivane] [--no-open] [--allow-origin URL]
  apivane run      [--dir .apivane] [--env NAME] [--folder NAME] [--bail]
                   [--reporter cli,junit,json,markdown] [--out reports] [--fail-on high|medium|low|none]
                   [--security off] [--timeout 30000]
  apivane init     [--dir .apivane]     create a starter collection
  apivane --version | --help

Exit codes (run): 0 all passed · 1 a test failed or a finding >= --fail-on · 2 usage or collection error`;

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (['no-open', 'bail', 'help', 'version'].includes(k)) o[k] = true;
    else {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new RunError(`--${k} needs a value`);
      if (k === 'allow-origin') (o[k] ||= []).push(v); else o[k] = v;
    }
  }
  return o;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref(); } catch { /* headless */ }
}

async function serve(o) {
  const port = Number(o.port || process.env.APIVANE_PORT || 7878);
  const host = o.host || process.env.APIVANE_HOST || '127.0.0.1';
  const token = process.env.APIVANE_TOKEN || newToken();
  const webDir = path.join(here, '..', 'web');
  const hasWeb = await fs.stat(path.join(webDir, 'index.html')).then(() => true, () => false);
  const extra = [...(o['allow-origin'] || []), ...(process.env.APIVANE_ALLOWED_ORIGINS || '').split(',').filter(Boolean)];
  const server = createAgent({ token, collectionDir: path.resolve(o.dir || '.apivane'), webDir: hasWeb ? webDir : undefined, allowOrigins: extra, version: pkg.version });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, res); });
  const url = `http://127.0.0.1:${port}/#token=${token}`;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') console.warn(`⚠  Listening on ${host}. Only do this inside a container that publishes the port to 127.0.0.1.`);
  console.log(`\n  ApiVane agent ${pkg.version}\n  Open:   ${url}\n  Token:  ${token}\n  Files:  ${path.resolve(o.dir || '.apivane')}\n\n  Using the website instead? Choose Connect → Local agent and paste the token.\n  Press Ctrl+C to stop.\n`);
  if (!o['no-open'] && !process.env.CI && hasWeb) openBrowser(url);
  await new Promise((res) => { process.once('SIGINT', res); process.once('SIGTERM', res); });
  server.close();
  return 0;
}

async function run(o) {
  const reporters = String(o.reporter || 'cli').split(',').map((s) => s.trim());
  const bad = reporters.find((r) => !['cli', 'junit', 'json', 'markdown'].includes(r));
  if (bad) throw new RunError(`Unknown reporter "${bad}"`);
  const failOn = o['fail-on'] || 'high';
  if (!['high', 'medium', 'low', 'info', 'none'].includes(failOn)) throw new RunError(`--fail-on must be high, medium, low, info or none`);
  const rep = await runCollection({
    dir: path.resolve(o.dir || o._[1] || '.apivane'), env: o.env, folder: o.folder, bail: !!o.bail,
    security: o.security === 'off' ? 'off' : 'default', timeoutMs: Number(o.timeout) || 30000,
    onResult: reporters.includes('cli') ? (r) => console.log(cliLine(r)) : undefined,
  });
  if (reporters.includes('cli')) console.log(summaryLine(rep));
  const out = path.resolve(o.out || 'reports');
  const writes = [];
  if (reporters.includes('junit')) writes.push(['apivane-junit.xml', junit(rep)]);
  if (reporters.includes('json')) writes.push(['apivane-report.json', JSON.stringify(rep, null, 2)]);
  if (reporters.includes('markdown')) writes.push(['apivane-summary.md', markdown(rep)]);
  if (writes.length) {
    await fs.mkdir(out, { recursive: true });
    for (const [n, c] of writes) await fs.writeFile(path.join(out, n), c);
  }
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown(rep)).catch(() => {});
  return exitCode(rep, failOn);
}

async function init(o) {
  const dir = path.resolve(o.dir || '.apivane');
  const exists = await fs.stat(path.join(dir, 'apivane.yaml')).then(() => true, () => false);
  if (exists) throw new RunError(`${dir} already has a collection`);
  const ws = {
    name: path.basename(process.cwd()), envs: [{ name: 'local', vars: [{ k: 'baseUrl', v: 'https://jsonplaceholder.typicode.com' }] }],
    requests: [newRequest({ folder: 'examples', name: 'List posts', url: '{{baseUrl}}/posts', auth: { type: 'none' }, params: [{ k: '_limit', v: '2', on: true }], tests: [{ status: 200 }, { jsonpath: '$[0].id', exists: true }, { maxDurationMs: 2000 }] })],
  };
  await writeCollection(dir, workspaceToFiles(ws));
  console.log(`Created ${dir}\nTry:  npx apivane-cli run --env local\nSecrets go in environment variables, e.g. TOKEN=... (referenced as \${env:TOKEN}).`);
  return 0;
}

export async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (o.version) { console.log(pkg.version); return 0; }
  if (o.help) { console.log(HELP); return 0; }
  const cmd = o._[0] || 'serve';
  try {
    if (cmd === 'serve') return await serve(o);
    if (cmd === 'run') return await run(o);
    if (cmd === 'init') return await init(o);
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    return 2;
  } catch (e) {
    if (e instanceof RunError || e.code === 'EADDRINUSE') { console.error(e.code === 'EADDRINUSE' ? `Port is already in use. Try --port ${Number(o.port || 7878) + 1}` : e.message); return 2; }
    throw e;
  }
}
