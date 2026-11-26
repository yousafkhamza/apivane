// ApiVane extension — sends requests for the ApiVane web app without the browser's CORS limits.
// Accepts messages only from its own content script running on the ApiVane app (checked by URL prefix).
// Never attaches the user's cookies (credentials: 'omit').
const api = globalThis.browser ?? globalThis.chrome;
const APP_URL = '__APP_URL__';
const ALLOWED_PREFIXES = __ALLOWED__;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 5 * 1024 * 1024;

const fail = (kind, message) => Object.assign(new Error(message), { kind });

function validate(p) {
  if (!p || typeof p !== 'object') throw fail('invalid', 'Bad request');
  if (!METHODS.includes(p.method)) throw fail('invalid', 'Unsupported method');
  let u;
  try { u = new URL(p.url); } catch { throw fail('url', 'Invalid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail('url', 'Only http and https URLs are allowed');
  const headers = {};
  for (const [k, v] of Object.entries(p.headers || {})) {
    if (typeof k !== 'string' || typeof v !== 'string') throw fail('invalid', 'Header names and values must be text');
    headers[k] = v;
  }
  if (p.body !== undefined && p.body !== null && typeof p.body !== 'string') throw fail('invalid', 'Body must be text');
  const timeoutMs = Math.min(Math.max(Number(p.timeoutMs) || 30000, 1000), 120000);
  return { method: p.method, url: u.href, headers, body: p.body ?? undefined, timeoutMs };
}

async function readLimited(resp) {
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { reader.cancel(); throw fail('too-large', 'Response is larger than 10 MB'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

async function send(p) {
  const r = validate(p);
  if (api.permissions?.contains && !(await api.permissions.contains({ origins: ['<all_urls>'] }))) {
    throw fail('blocked', 'The extension is not allowed to reach websites yet. Open your browser’s extension settings → ApiVane → Permissions and allow access to all sites.');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs);
  const t0 = performance.now();
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.method === 'GET' || r.method === 'HEAD' ? undefined : r.body, credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    const t1 = performance.now();
    const buf = await readLimited(resp);
    const t2 = performance.now();
    const headers = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const ct = headers['content-type'] || '';
    const textLike = !ct || /json|text|xml|javascript|html|x-www-form-urlencoded|graphql|yaml|csv/i.test(ct);
    return {
      status: resp.status, statusText: resp.statusText, headers, url: resp.url || r.url, size: buf.byteLength,
      binary: !textLike, text: textLike ? new TextDecoder().decode(buf.byteLength > MAX_TEXT ? buf.slice(0, MAX_TEXT) : buf) : '',
      truncated: buf.byteLength > MAX_TEXT, ms: Math.round(t2 - t0), ttfb: Math.round(t1 - t0),
    };
  } catch (e) {
    if (e.kind) throw e;
    if (e.name === 'AbortError') throw fail('timeout', `No answer after ${Math.round(r.timeoutMs / 1000)} seconds`);
    throw fail('blocked', `Could not reach the server: ${e.message}`);
  } finally { clearTimeout(timer); }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const from = sender.url || '';
  if (sender.id !== api.runtime.id || !ALLOWED_PREFIXES.some((p) => from.startsWith(p))) return false;
  const work = msg?.action === 'ping' ? Promise.resolve({ version: api.runtime.getManifest().version })
    : msg?.action === 'send' ? send(msg.payload) : Promise.reject(fail('invalid', 'Unknown action'));
  work.then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: { kind: e.kind || 'blocked', message: String(e.message || e) } }));
  return true; // async response
});

api.action.onClicked.addListener(() => api.tabs.create({ url: APP_URL }));
