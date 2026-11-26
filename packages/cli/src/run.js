// Headless CI runner: runs every request in .apivane/ in file order, with tests, captures and security checks.
import { filesToWorkspace, resolveRequest, missingVars, runTests, runSecurity, capture, parseJson, interpolate, maskSecrets, rank, slug } from '../core/index.js';
import { readCollection } from './files.js';
import { doFetch } from './http.js';

export class RunError extends Error {}

/**
 * @param {{dir:string, env?:string, folder?:string, bail?:boolean, timeoutMs?:number, security?:'default'|'off', processEnv?:Record<string,string>, onResult?:(r:object)=>void}} o
 */
export async function runCollection(o) {
  const files = await readCollection(o.dir);
  if (!files.length) throw new RunError(`No .yaml files found in ${o.dir}. Create requests in the ApiVane app and use "Save to repo", or run "apivane init".`);
  const ws = filesToWorkspace(files);
  if (ws.errors.length) throw new RunError('Could not read the collection:\n  ' + ws.errors.join('\n  '));
  const penv = o.processEnv || process.env;

  let vars = {};
  const secrets = [];
  if (o.env) {
    const e = ws.envs.find((x) => x.name === o.env || slug(x.name) === slug(o.env));
    if (!e) throw new RunError(`Environment "${o.env}" not found. Available: ${ws.envs.map((x) => x.name).join(', ') || 'none'}`);
    for (const v of e.vars) {
      const val = interpolate(v.v, {}, penv);
      const unresolved = val.match(/\$\{env:([A-Za-z_]\w*)\}/);
      if (unresolved) throw new RunError(`Environment variable ${unresolved[1]} is not set (needed by "${v.k}" in ${e.name}).`);
      vars[v.k] = val;
      if (v.secret) secrets.push(val);
    }
  }

  const list = ws.requests.filter((r) => !o.folder || r.folder === o.folder || slug(r.folder) === slug(o.folder));
  if (!list.length) throw new RunError(`No requests${o.folder ? ` in folder "${o.folder}"` : ''}.`);
  const caps = {};
  const results = [];
  const started = Date.now();
  for (const r of list) {
    const result = { name: r.name, folder: r.folder, method: r.method, url: '', status: null, ms: 0, tests: [], findings: [], error: null };
    try {
      const resolved = resolveRequest(r, { ...vars, ...caps }, { collectionAuth: ws.auth, env: penv });
      result.url = maskSecrets(resolved.url, [...secrets, ...Object.values(caps).map(String)]);
      const missing = missingVars(resolved);
      if (missing.length) throw new RunError(`Missing variable(s): ${missing.map((m) => `{{${m}}}`).join(', ')}`);
      const res = await doFetch({ ...resolved, timeoutMs: o.timeoutMs || 30000 });
      const json = res.text ? parseJson(res.text) : undefined;
      result.status = res.status;
      result.ms = res.ms;
      result.tests = runTests(r.tests, { status: res.status, headers: res.headers, json, ms: res.ms });
      Object.assign(caps, capture(r.capture, { headers: res.headers, json }));
      const rules = o.security === 'off' || r.security === 'off' ? 'off' : Array.isArray(r.security) ? r.security : 'default';
      result.findings = runSecurity({ url: res.url, res }, { rules }).findings;
    } catch (e) {
      result.error = e.message;
    }
    result.ok = !result.error && result.tests.every((t) => t.ok !== false);
    results.push(result);
    o.onResult?.(result);
    if (o.bail && !result.ok) break;
  }
  return { collection: ws.name, env: o.env || null, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, results };
}

/** Exit code: 1 if any request failed or any finding is at/above failOn ('none' disables the security gate). */
export function exitCode(report, failOn = 'high') {
  if (report.results.some((r) => !r.ok)) return 1;
  if (failOn !== 'none' && report.results.some((r) => r.findings.some((f) => rank(f.severity) >= rank(failOn)))) return 1;
  return 0;
}
