// cURL export/import and Postman v2.1 collection import.
import { newRequest, METHODS } from './request.js';

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** @param {{method:string,url:string,headers:Record<string,string>,body?:string}} r */
export function toCurl(r) {
  let c = `curl${r.method === 'GET' ? '' : ' -X ' + r.method} ${sq(r.url)}`;
  for (const [k, v] of Object.entries(r.headers)) c += ` \\\n  -H ${sq(`${k}: ${v}`)}`;
  if (r.body !== undefined && r.body !== '') c += ` \\\n  --data-raw ${sq(r.body)}`;
  return c;
}

function shellWords(s) {
  const out = [];
  let cur = '', inWord = false, i = 0;
  const src = s.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { if (inWord) { out.push(cur); cur = ''; inWord = false; } i++; continue; }
    inWord = true;
    if (ch === "'") { const j = src.indexOf("'", i + 1); if (j < 0) throw new Error('unclosed quote in cURL command'); cur += src.slice(i + 1, j); i = j + 1; }
    else if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === '\\' && /["\\$`]/.test(src[i + 1] || '')) i++; cur += src[i++]; }
      if (i >= src.length) throw new Error('unclosed quote in cURL command');
      i++;
    } else if (ch === '$' && src[i + 1] === "'") {
      const j = src.indexOf("'", i + 2); if (j < 0) throw new Error('unclosed quote in cURL command');
      cur += src.slice(i + 2, j).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'"); i = j + 1;
    } else if (ch === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 2; }
    else { cur += ch; i++; }
  }
  if (inWord) out.push(cur);
  return out;
}

export function parseCurl(cmd) {
  const w = shellWords(cmd.trim());
  if (!w.length || !/^curl(\.exe)?$/i.test(w[0])) throw new Error('Paste a command that starts with "curl"');
  const r = newRequest({ name: 'Imported from cURL', tests: [], auth: { type: 'none' } });
  let method, data = [], url = '';
  for (let i = 1; i < w.length; i++) {
    const a = w[i], next = () => w[++i] ?? '';
    if (a === '-X' || a === '--request') method = next().toUpperCase();
    else if (a === '-H' || a === '--header') { const h = next(), j = h.indexOf(':'); if (j > 0) r.headers.push({ k: h.slice(0, j).trim(), v: h.slice(j + 1).trim(), on: true }); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(a)) data.push(next());
    else if (a === '--json') { data.push(next()); r.headers.push({ k: 'Content-Type', v: 'application/json', on: true }); }
    else if (a === '-u' || a === '--user') { const [u, ...p] = next().split(':'); r.auth = { type: 'basic', username: u, password: p.join(':') }; }
    else if (a === '-I' || a === '--head') method = 'HEAD';
    else if (a === '--url') url = next();
    else if (['-A', '--user-agent', '-e', '--referer', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-b', '--cookie', '-x', '--proxy'].includes(a)) {
      const v = next();
      if (a === '-A' || a === '--user-agent') r.headers.push({ k: 'User-Agent', v, on: true });
      if (a === '-b' || a === '--cookie') r.headers.push({ k: 'Cookie', v, on: true });
    } else if (!a.startsWith('-') && !url) url = a;
  }
  if (!url) throw new Error('No URL found in the cURL command');
  const u = splitUrl(url);
  r.url = u.url; r.params = u.params;
  if (data.length) {
    const body = data.join('&');
    const ct = r.headers.find((h) => h.k.toLowerCase() === 'content-type')?.v || '';
    const isJson = ct.includes('json') || /^\s*[[{]/.test(body);
    r.body = { type: isJson ? 'json' : ct.includes('x-www-form-urlencoded') || /^[\w.%-]+=/.test(body) ? 'form' : 'text', content: isJson ? pretty(body) : body.replace(/&/g, '\n') };
    if (r.body.type === 'form') r.body.content = body.split('&').map((p) => { try { return decodeURIComponent(p.replace(/\+/g, ' ')); } catch { return p; } }).join('\n');
  }
  r.method = METHODS.includes(method) ? method : data.length ? 'POST' : 'GET';
  try { r.name = `${r.method} ${new URL(r.url).pathname}`; } catch { /* keep default */ }
  return r;
}

const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

function splitUrl(raw) {
  const q = raw.indexOf('?');
  if (q < 0) return { url: raw, params: [] };
  const params = raw.slice(q + 1).split('#')[0].split('&').filter(Boolean).map((p) => {
    const [k, ...v] = p.split('=');
    const d = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
    return { k: d(k), v: d(v.join('=')), on: true };
  });
  return { url: raw.slice(0, q), params };
}

/** Postman collection v2.0/v2.1 -> { name, requests, envs } */
export function importPostman(json) {
  const col = typeof json === 'string' ? JSON.parse(json) : json;
  if (!col?.info || !Array.isArray(col.item)) throw new Error('Not a Postman collection (v2.x expected)');
  const requests = [];
  const authOf = (a) => {
    if (!a || a.type === 'noauth') return a ? { type: 'none' } : { type: 'inherit' };
    const get = (arr, k) => (Array.isArray(arr) ? arr.find((x) => x.key === k)?.value : arr?.[k]) ?? '';
    if (a.type === 'bearer') return { type: 'bearer', token: get(a.bearer, 'token') };
    if (a.type === 'basic') return { type: 'basic', username: get(a.basic, 'username'), password: get(a.basic, 'password') };
    if (a.type === 'apikey') return { type: 'apikey', key: get(a.apikey, 'key'), value: get(a.apikey, 'value'), in: get(a.apikey, 'in') === 'query' ? 'query' : 'header' };
    return { type: 'inherit' };
  };
  const walk = (items, folder) => {
    for (const it of items) {
      if (Array.isArray(it.item)) { walk(it.item, folder === 'General' ? it.name : `${folder} - ${it.name}`); continue; }
      const q = it.request;
      if (!q) continue;
      const req = typeof q === 'string' ? { url: q, method: 'GET' } : q;
      const rawUrl = typeof req.url === 'string' ? req.url : req.url?.raw || '';
      const u = splitUrl(rawUrl);
      if (req.url && typeof req.url === 'object' && Array.isArray(req.url.query))
        u.params = req.url.query.map((p) => ({ k: p.key || '', v: p.value ?? '', on: !p.disabled }));
      const b = req.body;
      let body = { type: 'none', content: '' };
      if (b?.mode === 'raw') body = { type: b.options?.raw?.language === 'json' || /^\s*[[{]/.test(b.raw || '') ? 'json' : 'text', content: b.raw || '' };
      else if (b?.mode === 'urlencoded') body = { type: 'form', content: (b.urlencoded || []).filter((p) => !p.disabled).map((p) => `${p.key}=${p.value ?? ''}`).join('\n') };
      requests.push(newRequest({
        folder, name: it.name || 'Untitled', method: String(req.method || 'GET').toUpperCase(), url: u.url, params: u.params,
        headers: (Array.isArray(req.header) ? req.header : []).map((h) => ({ k: h.key, v: h.value ?? '', on: !h.disabled })),
        body, auth: authOf(req.auth), tests: [],
      }));
    }
  };
  walk(col.item, 'General');
  const envs = Array.isArray(col.variable) && col.variable.length
    ? [{ name: `${col.info.name || 'Postman'} variables`, vars: col.variable.map((v) => ({ k: v.key, v: String(v.value ?? ''), secret: v.type === 'secret' })) }] : [];
  return { name: col.info.name || 'Imported', requests, envs, auth: col.auth ? authOf(col.auth) : undefined };
}
