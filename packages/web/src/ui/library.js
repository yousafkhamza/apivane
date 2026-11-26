import { $, esc, icon } from '../dom.js';
import { S, env, SECRET_NAME } from '../state.js';

const RAIL = [
  { k: 'lib', label: 'Library', ic: 'lib' },
  { k: 'vars', label: 'Vars', ic: 'vars', cls: 'desk' },
  { k: 'hist', label: 'History', ic: 'hist', cls: 'desk' },
  { k: 'req', label: 'Request', ic: 'req', cls: 'mobile' },
  { k: 'res', label: 'Response', ic: 'res', cls: 'mobile' },
  { sep: true },
  { k: 'engine', label: 'Connect', ic: 'plug' },
  { k: 'settings', label: 'Settings', ic: 'gear' },
];

export function renderRail() {
  const phone = innerWidth <= 720;
  $('#rail').innerHTML = RAIL.map((r) => r.sep ? '<span class="sep"></span>'
    : `<button class="${r.cls || ''}" data-act="rail" data-k="${r.k}" aria-current="${phone ? (r.k === S.mview || (r.k === 'lib' && $('#lib').classList.contains('open'))) : r.k === S.lib}">${icon(r.ic)}${r.label}</button>`).join('');
}

const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

export function renderLib() {
  const body = $('#libBody'), acts = $('#libActions'), foot = $('#libFoot');
  if (S.lib === 'vars') return renderVars(body, acts, foot);
  if (S.lib === 'hist') {
    $('#libTitle').textContent = 'History';
    acts.innerHTML = S.history.length ? '<button class="btn sm ghost" data-act="clear-hist">Clear</button>' : '';
    foot.innerHTML = '';
    body.innerHTML = S.history.length ? S.history.map((h) => `<button class="item" data-act="open" data-id="${h.id}" title="${esc(h.url)}"><span class="m ${h.method}">${h.method}</span><span class="nm mono">${esc(h.url.replace(/^https?:\/\//, ''))}</span><span class="mono muted">${h.status} · ${ago(h.at)}</span></button>`).join('')
      : '<p class="hint" style="text-align:center;padding:30px 10px">Nothing yet. Your last 100 requests show here. Secrets are masked and nothing leaves this browser.</p>';
    return;
  }
  $('#libTitle').textContent = S.ws.name || 'Library';
  acts.innerHTML = `<button class="ibtn sm" data-act="new-req" title="New request" aria-label="New request">${icon('plus', 16)}</button>`;
  foot.innerHTML = '<button class="btn" data-act="import">⇪ Import Postman, cURL or backup</button><button class="btn ghost" data-act="run-all">▶ Run all requests</button>';
  const folders = [...new Set(S.ws.requests.map((r) => r.folder || 'General'))];
  const q = body.querySelector('.search')?.value || '';
  body.innerHTML = `<input class="search" type="search" placeholder="Search  ·  Ctrl K" aria-label="Search requests" value="${esc(q)}">` +
    (S.ws.requests.length ? '' : '<p class="hint" style="text-align:center;padding:20px 8px">No requests yet. Press + to add one, or import from Postman or cURL.</p>') +
    folders.map((f) => `<div class="grp"><span>${esc(f)}</span></div>` + S.ws.requests.filter((r) => (r.folder || 'General') === f).map((r) => {
      const res = S.results[r.id];
      const dot = S.sending.has(r.id) ? '<span class="spin" style="color:var(--copper)"></span>' : res?.res ? `<span class="dot ${res.res.status < 400 && res.tests.every((t) => t.ok !== false) ? 'ok' : 'bad'}" title="${res.res.status}"></span>` : res?.error ? '<span class="dot bad"></span>' : '';
      return `<button class="item" data-act="open" data-id="${r.id}" aria-current="${r.id === S.activeId}"><span class="m ${r.method}">${r.method}</span><span class="nm">${esc(r.name)}</span>${dot}</button>`;
    }).join('')).join('');
  filterLib(q);
}

export function filterLib(q) {
  const s = q.trim().toLowerCase();
  const body = $('#libBody');
  body.querySelectorAll('.item').forEach((b) => { b.hidden = !!s && !b.textContent.toLowerCase().includes(s); });
  body.querySelectorAll('.grp').forEach((g) => {
    let n = g.nextElementSibling, any = false;
    while (n && n.classList.contains('item')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
    g.hidden = !any;
  });
}

function renderVars(body, acts, foot) {
  const e = env();
  $('#libTitle').textContent = 'Variables';
  acts.innerHTML = `<button class="ibtn sm" data-act="new-env" title="New environment" aria-label="New environment">${icon('plus', 16)}</button>`;
  foot.innerHTML = '';
  if (!e) { body.innerHTML = '<p class="hint" style="padding:10px">No environment. Press + to create one.</p>'; return; }
  const caps = Object.entries(S.caps);
  body.innerHTML = `<div class="reqhead"><input value="${esc(e.name)}" data-env-name aria-label="Environment name"><button class="btn sm ghost danger" data-act="del-env">Delete</button></div>
    <table class="kv"><tr><th>Name</th><th>Value</th><th title="Secret">🔒</th><th></th></tr>
    ${e.vars.map((v, i) => `<tr><td><input type="text" value="${esc(v.k)}" data-v="${i}.k" aria-label="Variable name" spellcheck="false"></td>
      <td><input type="${v.secret ? 'password' : 'text'}" value="${esc(v.v)}" data-v="${i}.v" aria-label="Value" spellcheck="false" autocomplete="off"></td>
      <td class="ck"><input type="checkbox" ${v.secret ? 'checked' : ''} data-v="${i}.secret" aria-label="Secret"></td>
      <td class="act"><button class="rm" data-act="rm-var" data-i="${i}" aria-label="Remove">✕</button></td></tr>`).join('')}
    </table><button class="btn sm" style="margin-top:8px" data-act="add-var">+ Add variable</button>
    <p class="hint">Use as <span class="var">{{name}}</span> in URL, params, headers, body and auth. 🔒 Secret values are masked in history, cURL and exports.</p>
    ${caps.length ? `<div class="grp"><span>Saved from responses (this session)</span><button class="btn sm ghost" data-act="clear-caps">Clear</button></div>
      ${caps.map(([k, v]) => `<div class="item" style="cursor:default"><span class="var">{{${esc(k)}}}</span><span class="nm mono muted">${SECRET_NAME.test(k) ? '••••••' : esc(String(v))}</span></div>`).join('')}` : ''}`;
}
