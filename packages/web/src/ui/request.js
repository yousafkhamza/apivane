import { $, esc, icon } from '../dom.js';
import { S, cur, vars, mask } from '../state.js';
import { METHODS, resolveRequest, requestToDoc, stringify, testLabel } from '../../core/index.js';

export function renderTabs() {
  $('#tabs').innerHTML = S.openIds.map((id) => {
    const r = S.ws.requests.find((x) => x.id === id);
    if (!r) return '';
    return `<div class="tab" role="tab" aria-selected="${id === S.activeId}" data-act="tab" data-id="${id}" tabindex="0"><span class="m ${r.method}" style="min-width:0">${r.method}</span>${esc(r.name)}<button class="x" data-act="close-tab" data-id="${id}" aria-label="Close ${esc(r.name)}">✕</button></div>`;
  }).join('');
}

export function renderComposer() {
  const r = cur(), el = $('#composer');
  if (!r) { el.innerHTML = '<span class="muted" style="padding:6px">No request open. Pick one from the library or press + to create one.</span>'; return; }
  const busy = S.sending.has(r.id);
  el.innerHTML = `<select class="methodsel m ${r.method}" data-f="method" aria-label="HTTP method">${METHODS.map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <input class="url" data-f="url" value="${esc(r.url)}" placeholder="https://api.example.com/users  or  {{baseUrl}}/users" spellcheck="false" autocomplete="off" aria-label="Request URL">
    <button class="ibtn" data-act="curl" title="Copy as cURL" aria-label="Copy as cURL">${icon('copy', 16)}</button>
    <button class="send" data-act="send" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>' : 'Send'} <kbd>Ctrl ↵</kbd></button>`;
}

const REQ_TABS = [['params', 'Params'], ['headers', 'Headers'], ['body', 'Body'], ['auth', 'Auth'], ['tests', 'Tests'], ['file', 'File']];

function kv(list, rows) {
  return `<table class="kv"><tr><th></th><th>Key</th><th>Value</th><th></th></tr>${rows.map((p, i) => `<tr>
    <td class="ck"><input type="checkbox" ${p.on ? 'checked' : ''} data-f="${list}.${i}.on" aria-label="Enabled"></td>
    <td><input type="text" value="${esc(p.k)}" data-f="${list}.${i}.k" aria-label="Key" spellcheck="false"></td>
    <td><input type="text" value="${esc(p.v)}" data-f="${list}.${i}.v" aria-label="Value" spellcheck="false"></td>
    <td class="act"><button class="rm" data-act="rm-row" data-list="${list}" data-i="${i}" aria-label="Remove">✕</button></td></tr>`).join('')}
    <tr><td class="ck"></td><td><input type="text" placeholder="Add ${list === 'params' ? 'parameter' : 'header'}…" data-new="${list}" aria-label="New key" spellcheck="false"></td><td></td><td></td></tr></table>`;
}
const count = (rows) => { const n = rows.filter((p) => p.on && p.k).length; return n ? `<span class="n">${n}</span>` : ''; };

export function renderReq() {
  const r = cur(), el = $('#reqBody');
  if (!r) { $('#reqTabs').innerHTML = ''; el.innerHTML = ''; return; }
  $('#reqTabs').innerHTML = REQ_TABS.map(([k, l]) => `<button role="tab" data-act="req-tab" data-k="${k}" aria-selected="${S.reqTab === k}">${l}${k === 'params' ? count(r.params) : k === 'headers' ? count(r.headers) : k === 'tests' && r.tests.length ? `<span class="n">${r.tests.length}</span>` : ''}</button>`).join('');
  const folders = [...new Set(S.ws.requests.map((x) => x.folder))];
  let html = `<div class="reqhead"><input value="${esc(r.name)}" data-f="name" aria-label="Request name">
    <input class="folder" value="${esc(r.folder)}" data-f="folder" list="folderList" aria-label="Folder" title="Folder"><datalist id="folderList">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
    <button class="ibtn sm" data-act="dup-req" title="Duplicate" aria-label="Duplicate">${icon('dup', 15)}</button>
    <button class="ibtn sm" data-act="del-req" title="Delete" aria-label="Delete">${icon('trash', 15)}</button></div>`;
  const t = S.reqTab;
  if (t === 'params') html += kv('params', r.params) + `<p class="hint">Sends to <span class="mono" id="resolvedUrl">${esc(resolvedUrl(r))}</span></p>`;
  else if (t === 'headers') html += kv('headers', r.headers) + (S.engine === 'browser' ? '<p class="hint">In browser-only mode the browser controls <span class="mono">Cookie</span>, <span class="mono">Host</span> and <span class="mono">Origin</span>.</p>' : '');
  else if (t === 'body') html += bodyTab(r);
  else if (t === 'auth') html += authTab(r);
  else if (t === 'tests') html += testsTab(r);
  else html += `<p class="hint" style="margin:0 0 8px">How this request is saved in your repo (<span class="mono">.apivane/requests/</span>). Secrets stay as <span class="var">{{variables}}</span>.</p><pre class="json box" id="yamlOut">${esc(stringify(requestToDoc(r)))}</pre><button class="btn sm" style="margin-top:8px" data-act="copy-yaml">Copy YAML</button>`;
  el.innerHTML = html;
}

export function resolvedUrl(r) {
  try { return mask(resolveRequest(r, vars(), { collectionAuth: S.ws.auth }).url); } catch { return r.url; }
}

const seg = (act, cur, opts) => `<div class="seg" role="group">${opts.map(([k, l]) => `<button data-act="${act}" data-k="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;

function bodyTab(r) {
  if (r.method === 'GET' || r.method === 'HEAD') return '<p class="hint">GET and HEAD requests have no body. Change the method to POST, PUT or PATCH to send one.</p>';
  const b = r.body;
  let h = seg('body-type', b.type, [['none', 'None'], ['json', 'JSON'], ['form', 'Form'], ['text', 'Text']]);
  if (b.type === 'none') return h + '<p class="hint">No body will be sent.</p>';
  const ph = b.type === 'form' ? 'name=Yousaf\nrole=platform' : b.type === 'json' ? '{\n  "name": "{{userName}}"\n}' : 'Plain text';
  h += `<textarea class="code" style="margin-top:10px" data-f="body.content" spellcheck="false" placeholder="${esc(ph)}" aria-label="Body">${esc(b.content)}</textarea>`;
  if (b.type === 'json') h += `<p class="hint" id="jsonHint">${jsonHint(b.content)}</p>`;
  if (b.type === 'form') h += '<p class="hint">One <span class="mono">key=value</span> per line. Sent as application/x-www-form-urlencoded.</p>';
  return h;
}
export function jsonHint(s) {
  if (!s.trim()) return 'Tip: <span class="var">{{variables}}</span> work inside JSON strings.';
  try { JSON.parse(s.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '0')); return '✓ Valid JSON'; } catch (e) { return `<span style="color:var(--bad)">⚠ ${esc(e.message)}</span>`; }
}

function authTab(r) {
  const a = r.auth;
  let h = seg('auth-type', a.type, [['inherit', 'Inherit'], ['none', 'None'], ['bearer', 'Bearer'], ['basic', 'Basic'], ['apikey', 'API key']]) + '<div style="margin-top:12px">';
  const f = (key, label, ph = '', type = 'text') => `<label class="field">${label}<input type="${type}" value="${esc(a[key] || '')}" data-f="auth.${key}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></label>`;
  if (a.type === 'inherit') h += `<p class="hint" style="margin:0">Uses the collection's auth (${esc(S.ws.auth?.type || 'none')}). Change it in Settings.</p>`;
  else if (a.type === 'none') h += '<p class="hint" style="margin:0">No auth header will be added.</p>';
  else if (a.type === 'bearer') h += f('token', 'Token', '{{token}}');
  else if (a.type === 'basic') h += `<div class="grid2">${f('username', 'Username')}${f('password', 'Password', '{{password}}', 'password')}</div>`;
  else h += `<div class="grid2">${f('key', 'Name', 'X-API-Key')}${f('value', 'Value', '{{apiKey}}')}</div><div style="margin-top:10px">${seg('auth-in', a.in || 'header', [['header', 'In header'], ['query', 'In query string']])}</div>`;
  return h + '<p class="hint">Tip: put secrets in a 🔒 variable and use <span class="var">{{name}}</span> here.</p></div>';
}

const TEST_TYPES = [['status', 'Status code'], ['jsonpath', 'JSON value'], ['header', 'Header'], ['maxDurationMs', 'Max time (ms)']];
export const testType = (t) => TEST_TYPES.find(([k]) => k in t)?.[0] || 'status';

function testsTab(r) {
  const rows = r.tests.map((t, i) => {
    const ty = testType(t);
    const sel = `<select data-test="${i}" data-tf="type" aria-label="Test type">${TEST_TYPES.map(([k, l]) => `<option value="${k}" ${k === ty ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const inp = (tf, v, ph) => `<input data-test="${i}" data-tf="${tf}" value="${esc(v ?? '')}" placeholder="${ph}" spellcheck="false" aria-label="${ph}">`;
    let a = '', b = '<span></span>';
    if (ty === 'status') a = inp('a', t.status, '200');
    if (ty === 'maxDurationMs') a = inp('a', t.maxDurationMs, '800');
    if (ty === 'jsonpath') { a = inp('a', t.jsonpath, '$.data.id'); b = inp('b', 'equals' in t ? JSON.stringify(t.equals) : '', 'equals (empty = exists)'); }
    if (ty === 'header') { a = inp('a', t.header, 'content-type'); b = inp('b', t.contains, 'contains (empty = exists)'); }
    return `<div class="trow" title="${esc(testLabel(t))}">${sel}${a}${b}<button class="rm" data-act="rm-test" data-i="${i}" aria-label="Remove test">✕</button></div>`;
  }).join('');
  const caps = Object.entries(r.capture || {});
  return `<div class="box"><h3>Check the response</h3>${rows || '<p class="hint" style="margin:0 0 8px">No tests yet.</p>'}<button class="btn sm" data-act="add-test">+ Add check</button></div>
    <div class="box" style="margin-top:10px"><h3>Save values for the next request</h3>
    ${caps.map(([k, v], i) => `<div class="trow" style="grid-template-columns:1fr 1fr 34px"><input data-cap="${i}" data-cf="k" value="${esc(k)}" placeholder="variable name" aria-label="Variable name"><input data-cap="${i}" data-cf="v" value="${esc(v)}" placeholder="$.token or header:x-id" aria-label="Path"><button class="rm" data-act="rm-cap" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}
    <button class="btn sm" data-act="add-cap">+ Save a value</button><p class="hint">Example: save <span class="mono">$.accessToken</span> as <span class="var">{{token}}</span>, then use it in the next request.</p></div>
    <div class="switch"><div>Security checks<small>Run SEC rules on every response</small></div>${seg('sec', r.security === 'off' ? 'off' : 'default', [['default', 'On'], ['off', 'Off']])}</div>
    <p class="hint">No scripting needed. The same checks run in CI with <span class="mono">npx apivane run</span>.</p>`;
}
