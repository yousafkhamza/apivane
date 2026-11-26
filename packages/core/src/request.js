// Request model, variable interpolation and resolving a request into what gets sent.
// Pure functions: no DOM, no Node APIs — shared by the web UI, the agent and the CI runner.

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;
const ENV = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * @typedef {{k:string,v:string,on:boolean}} Pair
 * @typedef {{type:'none'|'inherit'|'bearer'|'basic'|'apikey', token?:string, username?:string,
 *   password?:string, key?:string, value?:string, in?:'header'|'query'}} Auth
 * @typedef {{id?:string, folder:string, name:string, method:string, url:string, params:Pair[],
 *   headers:Pair[], body:{type:'none'|'json'|'text'|'form', content:string}, auth:Auth,
 *   tests:object[], capture:Record<string,string>, security?:'default'|'off'}} Request
 */

/** @returns {Request} */
export function newRequest(over = {}) {
  return {
    folder: 'General', name: 'New request', method: 'GET', url: '', params: [], headers: [],
    body: { type: 'none', content: '' }, auth: { type: 'inherit' }, tests: [{ status: 200 }],
    capture: {}, security: 'default', ...over,
  };
}

/** Replace {{var}} from vars and ${env:NAME} from env (CLI/agent only). Unknown names stay as-is. */
export function interpolate(str, vars = {}, env) {
  let s = String(str ?? '').replace(VAR, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  if (env) s = s.replace(ENV, (m, k) => (env[k] !== undefined ? env[k] : m));
  return s;
}

/** Names of {{vars}} that are still unresolved anywhere in the resolved request. */
export function missingVars(resolved) {
  const text = [resolved.url, ...Object.values(resolved.headers), resolved.body ?? ''].join('\n');
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]))];
}

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/**
 * @param {Request} req
 * @param {Record<string,unknown>} vars
 * @param {{collectionAuth?:Auth, env?:Record<string,string>}} [opts]
 * @returns {{method:string,url:string,headers:Record<string,string>,body:string|undefined}}
 */
export function resolveRequest(req, vars = {}, opts = {}) {
  const I = (s) => interpolate(s, vars, opts.env);
  let url = I(req.url).trim();
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
  const query = req.params.filter((p) => p.on && p.k).map((p) => [I(p.k), I(p.v)]);
  const headers = {};
  for (const h of req.headers) if (h.on && h.k) headers[I(h.k)] = I(h.v);
  const has = (name) => Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());

  const auth = req.auth?.type === 'inherit' ? opts.collectionAuth || { type: 'none' } : req.auth || { type: 'none' };
  if (auth.type === 'bearer' && auth.token && !has('authorization')) headers.Authorization = 'Bearer ' + I(auth.token);
  if (auth.type === 'basic' && !has('authorization')) headers.Authorization = 'Basic ' + b64(`${I(auth.username || '')}:${I(auth.password || '')}`);
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') query.push([I(auth.key), I(auth.value || '')]);
    else if (!has(auth.key)) headers[I(auth.key)] = I(auth.value || '');
  }

  if (query.length) {
    const qs = query.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const hash = url.indexOf('#');
    const base = hash < 0 ? url : url.slice(0, hash);
    url = base + (base.includes('?') ? '&' : '?') + qs + (hash < 0 ? '' : url.slice(hash));
  }

  let body;
  const noBody = req.method === 'GET' || req.method === 'HEAD';
  if (!noBody && req.body && req.body.type !== 'none') {
    body = I(req.body.content);
    if (req.body.type === 'json' && !has('content-type')) headers['Content-Type'] = 'application/json';
    if (req.body.type === 'text' && !has('content-type')) headers['Content-Type'] = 'text/plain';
    if (req.body.type === 'form') {
      // content holds "key=value" lines
      body = body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const i = l.indexOf('=');
        const [k, v] = i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)];
        return encodeURIComponent(k.trim()) + '=' + encodeURIComponent(v.trim());
      }).join('&');
      if (!has('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  return { method: req.method, url, headers, body };
}

/** Replace every secret value with •••••• (UI, history, cURL, reports). */
export function maskSecrets(text, secrets) {
  let s = String(text);
  for (const v of secrets) if (v && String(v).length >= 3) s = s.split(String(v)).join('••••••');
  return s;
}
