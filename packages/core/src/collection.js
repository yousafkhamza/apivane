// Workspace <-> .apivane/ files. One request per YAML file so pull requests show clean diffs.
import { stringify, parse } from './yaml.js';
import { newRequest } from './request.js';

/**
 * @typedef {{k:string,v:string,secret?:boolean}} Var
 * @typedef {{id?:string,name:string,vars:Var[]}} Env
 * @typedef {{name:string, auth?:object, requests:import('./request.js').Request[], envs:Env[]}} Workspace
 */

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled';
const safeDir = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 60) || 'General';
const envRef = (k) => '${env:' + k.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '}';

const pairsToMap = (pairs) => {
  const on = pairs.filter((p) => p.on && p.k);
  return on.length ? Object.fromEntries(on.map((p) => [p.k, p.v])) : undefined;
};
const mapToPairs = (m) => Object.entries(m || {}).map(([k, v]) => ({ k, v: v === null ? '' : String(v), on: true }));

export function requestToDoc(r) {
  let body;
  if (r.body && r.body.type !== 'none') {
    let content = r.body.content;
    if (r.body.type === 'json') { try { content = JSON.parse(content); } catch { /* keep text */ } }
    body = { type: r.body.type, content };
  }
  const auth = !r.auth || r.auth.type === 'inherit' ? 'inherit' : r.auth.type === 'none' ? 'none' : { ...r.auth };
  return {
    name: r.name, method: r.method, url: r.url,
    query: pairsToMap(r.params), headers: pairsToMap(r.headers), body, auth,
    tests: r.tests?.length ? r.tests : undefined,
    capture: r.capture && Object.keys(r.capture).length ? r.capture : undefined,
    security: r.security && r.security !== 'default' ? r.security : undefined,
  };
}

export function docToRequest(d, folder = 'General') {
  if (!d || typeof d !== 'object' || !d.url) throw new Error('request file needs at least "url"');
  const b = d.body;
  const body = !b || b.type === 'none' ? { type: 'none', content: '' }
    : { type: ['json', 'text', 'form'].includes(b.type) ? b.type : 'text', content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '', null, 2) };
  const auth = typeof d.auth === 'string' ? { type: d.auth } : d.auth && typeof d.auth === 'object' ? d.auth : { type: 'inherit' };
  return newRequest({
    folder, name: String(d.name || 'Untitled'), method: String(d.method || 'GET').toUpperCase(), url: String(d.url),
    params: mapToPairs(d.query), headers: mapToPairs(d.headers), body, auth,
    tests: Array.isArray(d.tests) ? d.tests : [], capture: d.capture || {}, security: d.security || 'default',
  });
}

/** @param {Workspace} ws @returns {{path:string,content:string}[]} paths relative to .apivane/ */
export function workspaceToFiles(ws) {
  const files = [{ path: 'apivane.yaml', content: stringify({ name: ws.name || 'My APIs', auth: ws.auth && ws.auth.type !== 'none' ? ws.auth : undefined, version: 1 }) }];
  for (const e of ws.envs || []) {
    const vars = {}, secrets = [];
    for (const v of e.vars) {
      if (!v.k) continue;
      if (v.secret) { secrets.push(v.k); vars[v.k] = String(v.v).startsWith('${env:') ? v.v : envRef(v.k); }
      else vars[v.k] = v.v;
    }
    files.push({ path: `environments/${slug(e.name)}.yaml`, content: stringify({ name: e.name, vars, secrets: secrets.length ? secrets : undefined }) });
  }
  const counters = {}, used = new Set();
  for (const r of ws.requests || []) {
    const dir = safeDir(r.folder);
    const n = (counters[dir] = (counters[dir] || 0) + 1);
    let p = `requests/${dir}/${String(n).padStart(2, '0')}-${slug(r.name)}.yaml`;
    while (used.has(p)) p = p.replace(/\.yaml$/, '-1.yaml');
    used.add(p);
    files.push({ path: p, content: stringify(requestToDoc(r)) });
  }
  return files;
}

/** @param {{path:string,content:string}[]} files @returns {Workspace & {errors:string[]}} */
export function filesToWorkspace(files) {
  const ws = { name: 'My APIs', requests: [], envs: [], errors: [] };
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const f of sorted) {
    const p = f.path.replace(/\\/g, '/').replace(/^\.?\/?(\.apivane\/)?/, '');
    if (!/\.ya?ml$/.test(p)) continue;
    try {
      const doc = parse(f.content);
      if (p === 'apivane.yaml') { ws.name = doc?.name || ws.name; if (doc?.auth) ws.auth = typeof doc.auth === 'string' ? { type: doc.auth } : doc.auth; }
      else if (p.startsWith('environments/')) {
        const secrets = new Set(doc?.secrets || []);
        ws.envs.push({ name: doc?.name || p.slice(13).replace(/\.ya?ml$/, ''), vars: Object.entries(doc?.vars || {}).map(([k, v]) => ({ k, v: v === null ? '' : String(v), secret: secrets.has(k) })) });
      } else if (p.startsWith('requests/')) {
        const parts = p.split('/');
        ws.requests.push(docToRequest(doc, parts.length > 2 ? parts[1] : 'General'));
      }
    } catch (e) { ws.errors.push(`${p}: ${e.message}`); }
  }
  return ws;
}
