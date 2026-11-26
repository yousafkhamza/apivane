// Three ways to send a request: the browser itself, the ApiVane extension, or the local agent.
import { LS, SS } from './dom.js';

const TIMEOUT = 30000;
const MAX_TEXT = 5 * 1024 * 1024;

export class SendError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

const textLike = (ct) => !ct || /json|text|xml|javascript|html|x-www-form-urlencoded|graphql|yaml|csv/i.test(ct);
function decode(buf, ct) {
  const size = buf.byteLength;
  if (!textLike(ct)) return { text: '', binary: true, size };
  const text = new TextDecoder().decode(size > MAX_TEXT ? buf.slice(0, MAX_TEXT) : buf);
  return { text, binary: false, size, truncated: size > MAX_TEXT };
}
const lower = (h) => { const o = {}; h.forEach((v, k) => { o[k.toLowerCase()] = v; }); return o; };

// ---------- browser ----------
async function viaBrowser(r) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  const t0 = performance.now();
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body, signal: ctl.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
    const t1 = performance.now();
    const buf = await resp.arrayBuffer();
    const t2 = performance.now();
    return { status: resp.status, statusText: resp.statusText, headers: lower(resp.headers), ...decode(buf, resp.headers.get('content-type')),
      ms: Math.round(t2 - t0), ttfb: Math.round(t1 - t0), url: resp.url || r.url, headersVisible: false };
  } catch (e) {
    if (e.name === 'AbortError') throw new SendError('timeout', 'No answer after 30 seconds');
    if (/fetch|network|load failed/i.test(e.message)) {
      throw new SendError('blocked', e.message, {
        insecure: location.protocol === 'https:' && r.url.startsWith('http:') && !/^http:\/\/(localhost|127\.)/.test(r.url),
        local: /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.url),
      });
    }
    throw new SendError('invalid', e.message);
  } finally { clearTimeout(timer); }
}

// ---------- extension (content-script bridge via window.postMessage) ----------
const pending = new Map();
let extInfo = null;
addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.apivane !== 'res' || !pending.has(d.id)) return;
  const p = pending.get(d.id);
  pending.delete(d.id);
  d.ok ? p.res(d.data) : p.rej(new SendError(d.error?.kind || 'blocked', d.error?.message || 'Extension error'));
});
function ext(action, payload, ms) {
  return new Promise((res, rej) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    pending.set(id, { res, rej });
    window.postMessage({ apivane: 'req', id, action, payload }, location.origin);
    setTimeout(() => { if (pending.delete(id)) rej(new SendError('timeout', 'The extension did not answer')); }, ms);
  });
}
export async function detectExtension() {
  try { extInfo = await ext('ping', null, 800); } catch { extInfo = null; }
  return extInfo;
}
async function viaExtension(r) {
  const out = await ext('send', { ...r, timeoutMs: TIMEOUT }, TIMEOUT + 5000);
  return { ...out, headersVisible: true };
}

// ---------- local agent ----------
const onAgentOrigin = () => /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(location.origin) && !!document.querySelector('meta[name="apivane-agent"]');
export const agent = {
  get base() { return onAgentOrigin() ? location.origin : LS.get('agentUrl', 'http://127.0.0.1:7878'); },
  set base(v) { LS.set('agentUrl', v.replace(/\/+$/, '')); },
  get token() { return SS.get('agentToken') || ''; },
  set token(v) { SS.set('agentToken', v || null); },
  info: null,
};
// Token handoff: the agent opens http://127.0.0.1:7878/#token=...
const m = location.hash.match(/token=([\w-]{16,})/);
if (m) { agent.token = m[1]; history.replaceState(null, '', location.pathname + location.search); }

async function agentFetch(path, init = {}) {
  let resp;
  try {
    resp = await fetch(agent.base + path, { ...init, headers: { 'Content-Type': 'application/json', 'X-ApiVane-Token': agent.token, ...(init.headers || {}) } });
  } catch { throw new SendError('agent-down', 'Local agent is not reachable'); }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new SendError('agent-token', 'The agent token is missing or wrong');
  if (!resp.ok) throw new SendError(data.kind || 'agent', data.error || `Agent error ${resp.status}`);
  return data;
}
export async function detectAgent() {
  if (!agent.token) return (agent.info = null);
  try { agent.info = await agentFetch('/api/health'); } catch { agent.info = null; }
  return agent.info;
}
const viaAgent = (r) => agentFetch('/api/send', { method: 'POST', body: JSON.stringify({ ...r, timeoutMs: TIMEOUT }) }).then((d) => ({ ...d, headersVisible: true }));
export const agentFiles = {
  read: () => agentFetch('/api/collection'),
  write: (files) => agentFetch('/api/collection', { method: 'PUT', body: JSON.stringify({ files }) }),
};

export const ENGINES = {
  browser: { name: 'Browser only', send: viaBrowser, available: () => true },
  ext: { name: 'Extension', send: viaExtension, available: () => !!extInfo, info: () => extInfo },
  agent: { name: 'Local agent', send: viaAgent, available: () => !!agent.info, info: () => agent.info },
};
export const isAgentOrigin = onAgentOrigin;
