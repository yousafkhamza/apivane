import { $, LS, toast, copy, uid, setPath, icon } from './dom.js';
import { S, cur, env, vars, mask, autosaveOn, markDirty, save, flush, saveHistory, loadState, replaceWorkspace, discardDraft, onSaveState } from './state.js';
import { sampleWorkspace } from './samples.js';
import { ENGINES, detectExtension, detectAgent, agent, isAgentOrigin } from './engines.js';
import { renderRail, renderLib, filterLib } from './ui/library.js';
import { renderTabs, renderComposer, renderReq, resolvedUrl, jsonHint } from './ui/request.js';
import { renderRes } from './ui/response.js';
import { closeDialog, openEngineDialog, openSettings, openImport, openRunReport } from './ui/dialogs.js';
import { startTour, tourNext, tourBack, rerenderStep, endTour, tourOpen } from './ui/onboarding.js';
import { exportBackup, importText, saveToRepo, loadFromRepo } from './io.js';
import { resolveRequest, missingVars, runTests, runSecurity, capture, parseJson, toCurl, newRequest } from '../core/index.js';

// ---------- theme: follows the device unless the user pins light/dark ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
const THEMES = { system: ['◐', 'match device'], light: ['☀', 'light'], dark: ['☾', 'dark'] };
function applyTheme() {
  const p = LS.get('theme', 'system');
  document.documentElement.dataset.theme = (p === 'system' ? mq.matches : p === 'dark') ? 'dark' : 'light';
  $('#themeBtn').textContent = THEMES[p][0];
  $('#themeBtn').title = `Theme: ${THEMES[p][1]}`;
}
mq.addEventListener('change', () => { applyTheme(); if (tourOpen()) rerenderStep(); });

// ---------- header ----------
function renderSave() {
  const b = $('#saveBtn');
  b.className = 'save' + (S.dirty && !autosaveOn() ? ' dirty' : '');
  b.disabled = !(S.dirty && !autosaveOn());
  b.textContent = S.dirty ? (autosaveOn() ? 'Saving…' : 'Unsaved · Save') : S.ws.savedAt ? '✓ Saved' : 'Sample data';
  b.title = S.dirty && !autosaveOn() ? 'Save (Ctrl+S)' : S.ws.savedAt ? 'Saved on this device' : 'Change anything and it becomes your own workspace';
}
onSaveState(renderSave);
function renderHeader() {
  const e = ENGINES[S.engine];
  $('#engineDot').className = 'dot ' + (S.engine === 'browser' ? 'browser' : 'ok');
  $('#engineLbl').textContent = S.engine === 'browser' ? 'Browser only' : `${e.name} · connected`;
  $('#envSel').innerHTML = S.ws.envs.map((x) => `<option value="${x.id}" ${x.id === S.ws.activeEnvId ? 'selected' : ''}>${x.name.replace(/</g, '&lt;')}</option>`).join('') + `<option value="" ${S.ws.activeEnvId ? '' : 'selected'}>No environment</option>`;
  renderSave();
}
function renderAll() {
  renderHeader(); renderRail(); renderLib(); renderTabs(); renderComposer(); renderReq(); renderRes();
  $('#panes').dataset.mview = S.mview;
}
const focusEnd = (sel) => { const i = $(sel); if (i) { i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); } };

function openReq(id) {
  if (!S.ws.requests.some((r) => r.id === id)) { toast('That request no longer exists'); return; }
  if (!S.openIds.includes(id)) { S.openIds.push(id); if (S.openIds.length > 8) S.openIds = S.openIds.filter((x) => x !== S.openIds.find((y) => y !== id)); }
  S.activeId = id;
  S.mview = 'req';
  $('#lib').classList.remove('open');
  closeDialog();
  renderAll();
}
function setEngine(k) {
  if (!ENGINES[k].available()) { toast(k === 'ext' ? 'Install the extension first, then press “Check again”' : 'Connect the agent first'); return; }
  S.engine = k;
  LS.set('engine', k);
  renderAll();
}

// ---------- send ----------
async function send(r = cur(), quiet = false) {
  if (!r || S.sending.has(r.id)) return null;
  let out;
  const resolved = resolveRequest(r, vars(), { collectionAuth: S.ws.auth });
  const missing = missingVars(resolved);
  if (missing.length) out = { error: { kind: 'var', missing } };
  else {
    try {
      const u = new URL(resolved.url);
      if (!/^https?:$/.test(u.protocol)) out = { error: { kind: 'url', message: 'Only http:// and https:// URLs are supported.' } };
    } catch { out = { error: { kind: 'url', message: `“${resolved.url || '(empty)'}” is not a valid URL.` } }; }
  }
  if (!out) {
    const eng = ENGINES[S.engine].available() ? S.engine : 'browser';
    S.sending.add(r.id);
    if (!quiet) { renderComposer(); renderLib(); }
    try {
      const res = await ENGINES[eng].send(resolved);
      const json = res.text ? parseJson(res.text) : undefined;
      const tests = runTests(r.tests, { status: res.status, headers: res.headers, json, ms: res.ms }, { headersVisible: res.headersVisible });
      const caps = capture(r.capture, { headers: res.headers, json });
      Object.assign(S.caps, caps);
      const sec = r.security === 'off' ? { findings: [], skipped: [], off: true } : runSecurity({ url: res.url || resolved.url, res }, { headersVisible: res.headersVisible });
      out = { res, json, tests, sec, captured: Object.keys(caps) };
      if (!quiet && out.captured.length) toast(`Saved ${out.captured.map((k) => `{{${k}}}`).join(', ')} for your next requests`);
    } catch (e) {
      out = { error: { kind: e.kind || 'blocked', message: e.message, insecure: e.insecure, local: e.local } };
    } finally { S.sending.delete(r.id); }
    S.history.unshift({ id: r.id, method: r.method, url: mask(resolved.url), status: out.res?.status ?? 'ERR', at: Date.now() });
    S.history.length = Math.min(S.history.length, 100);
    saveHistory();
  }
  S.results[r.id] = out;
  if (!quiet) { if (r.id === S.activeId) { S.resTab = 'body'; S.mview = 'res'; } renderAll(); }
  return out;
}

async function runAll() {
  const list = [...S.ws.requests];
  if (!list.length) return;
  toast(`Running ${list.length} requests in order…`);
  const rows = [];
  for (const r of list) {
    renderLib();
    const o = await send(r, true);
    const failed = o?.tests?.filter((t) => t.ok === false) || [];
    rows.push({ id: r.id, name: r.name, ok: !!o?.res && !failed.length, ms: o?.res?.ms,
      detail: o?.error ? (o.error.kind === 'var' ? `Missing {{${o.error.missing.join('}}, {{')}}}` : o.error.message || o.error.kind) : failed.length ? failed.map((t) => `${t.name} (got ${t.got})`).join('; ') : `${o.res.status} · ${o.tests.length} checks passed` });
  }
  renderAll();
  openRunReport(rows);
}

function curlText() {
  const r = cur();
  const x = resolveRequest(r, vars(), { collectionAuth: S.ws.auth });
  const h = {};
  for (const [k, v] of Object.entries(x.headers)) h[k] = mask(v);
  return toCurl({ method: x.method, url: mask(x.url), headers: h, body: x.body === undefined ? undefined : mask(x.body) });
}

// ---------- install as app ----------
let deferredInstall = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); if (standalone) return; deferredInstall = e; $('#installBtn').classList.add('show'); });
addEventListener('appinstalled', () => { deferredInstall = null; $('#installBtn').classList.remove('show'); toast('ApiVane installed — find it with your apps'); });
async function install() {
  if (!deferredInstall) { toast(/iphone|ipad/i.test(navigator.userAgent) ? 'Tap Share, then “Add to Home Screen”' : 'Use your browser menu → “Install ApiVane”'); return; }
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  $('#installBtn').classList.remove('show');
}

const tourCtx = () => ({
  weather: S.ws.requests.find((r) => r.name === 'Dubai weather now')?.id,
  login: S.ws.requests.find((r) => r.name === 'Log in')?.id,
  canInstall: !!deferredInstall,
});
const finishTour = (id) => { endTour(); if (id) openReq(id); else renderAll(); };

// ---------- actions (event delegation on data-act) ----------
const A = {
  engine: openEngineDialog,
  save: () => save().then(() => toast('Saved on this device')),
  theme: () => { const o = Object.keys(THEMES), p = LS.get('theme', 'system'); LS.set('theme', o[(o.indexOf(p) + 1) % 3]); applyTheme(); toast($('#themeBtn').title); },
  install,
  rail: (el) => {
    const k = el.dataset.k, lib = $('#lib');
    if (k === 'engine') return openEngineDialog();
    if (k === 'settings') return openSettings();
    if (k === 'req' || k === 'res') { S.mview = k; lib.classList.remove('open'); return renderAll(); }
    const floating = innerWidth <= 980;
    if (floating && S.lib === k && lib.classList.contains('open')) lib.classList.remove('open');
    else { S.lib = k; if (floating) lib.classList.add('open'); }
    renderRail(); renderLib();
  },
  open: (el) => openReq(el.dataset.id),
  'new-req': () => {
    const r = { id: uid(), ...newRequest({ folder: cur()?.folder || 'General' }) };
    S.ws.requests.push(r); S.reqTab = 'params'; markDirty(); openReq(r.id);
    setTimeout(() => $('.url')?.focus());
  },
  'dup-req': () => { const r = cur(), c = { ...JSON.parse(JSON.stringify(r)), id: uid(), name: r.name + ' (copy)' }; S.ws.requests.splice(S.ws.requests.indexOf(r) + 1, 0, c); markDirty(); openReq(c.id); },
  'del-req': () => {
    const r = cur();
    if (!confirm(`Delete “${r.name}”?`)) return;
    S.ws.requests = S.ws.requests.filter((x) => x !== r);
    S.openIds = S.openIds.filter((x) => x !== r.id);
    S.activeId = S.openIds[S.openIds.length - 1] || S.ws.requests[0]?.id || null;
    if (S.activeId && !S.openIds.includes(S.activeId)) S.openIds.push(S.activeId);
    markDirty(); renderAll();
  },
  tab: (el) => { S.activeId = el.dataset.id; S.mview = 'req'; renderAll(); },
  'close-tab': (el, e) => {
    e.stopPropagation();
    const id = el.dataset.id, i = S.openIds.indexOf(id);
    S.openIds = S.openIds.filter((x) => x !== id);
    if (S.activeId === id) S.activeId = S.openIds[Math.max(0, i - 1)] || null;
    renderAll();
  },
  send: () => send(),
  curl: () => cur() && copy(curlText(), 'cURL copied — secrets masked'),
  'req-tab': (el) => { S.reqTab = el.dataset.k; renderReq(); },
  'res-tab': (el) => { S.resTab = el.dataset.k; renderRes(); },
  'rm-row': (el) => { cur()[el.dataset.list].splice(+el.dataset.i, 1); markDirty(); renderReq(); },
  'body-type': (el) => { const b = cur().body; b.type = el.dataset.k; if (b.type === 'json' && !b.content.trim()) b.content = '{\n  \n}'; markDirty(); renderReq(); },
  'auth-type': (el) => { cur().auth = { ...cur().auth, type: el.dataset.k }; markDirty(); renderReq(); },
  'auth-in': (el) => { cur().auth.in = el.dataset.k; markDirty(); renderReq(); },
  sec: (el) => { cur().security = el.dataset.k; markDirty(); renderReq(); },
  'add-test': () => { cur().tests.push({ status: 200 }); markDirty(); renderReq(); },
  'rm-test': (el) => { cur().tests.splice(+el.dataset.i, 1); markDirty(); renderReq(); },
  'add-cap': () => { const c = cur().capture; let n = 1; while (`value${n}` in c) n++; c[`value${n}`] = '$.'; markDirty(); renderReq(); },
  'rm-cap': (el) => { const r = cur(); r.capture = Object.fromEntries(Object.entries(r.capture).filter((_, i) => i !== +el.dataset.i)); markDirty(); renderReq(); },
  view: (el) => { S.view = el.dataset.k; renderRes(); },
  'copy-body': () => { const o = S.results[S.activeId]; o?.res && copy(S.view === 'pretty' && o.json !== undefined ? JSON.stringify(o.json, null, 2) : o.res.text); },
  'copy-yaml': () => copy($('#yamlOut').textContent, 'YAML copied'),
  copy: (el) => copy(el.dataset.text),
  'dlg-close': closeDialog,
  'engine-pick': (el) => { setEngine(el.dataset.k); tourOpen() ? rerenderStep() : openEngineDialog(); },
  'ext-recheck': async () => { const ok = await detectExtension(); toast(ok ? 'Extension found' : 'Extension not found — reload this page after installing'); tourOpen() ? rerenderStep() : openEngineDialog(); },
  'agent-connect': async () => {
    agent.base = $('#agentUrl').value.trim() || 'http://127.0.0.1:7878';
    agent.token = $('#agentToken').value.trim();
    if (await detectAgent()) { setEngine('agent'); toast('Connected to the local agent'); } else toast('Could not reach the agent. Is `npx apivane-cli` running and the token right?');
    tourOpen() ? rerenderStep() : openEngineDialog();
  },
  'set-autosave': (el) => { LS.set('autosave', el.dataset.k); if (el.dataset.k === '1' && S.dirty) save(); renderSave(); openSettings(); },
  'set-theme': (el) => { LS.set('theme', el.dataset.k); applyTheme(); openSettings(); },
  export: exportBackup,
  import: openImport,
  'import-file': () => $('#fileIn').click(),
  'import-paste': () => { const id = importText($('#importText').value); if (id) openReq(id); else renderAll(); },
  'repo-save': () => saveToRepo().catch((e) => toast(e.message)),
  'repo-load': async () => { try { if (await loadFromRepo()) { closeDialog(); renderAll(); } } catch (e) { toast(e.message); } },
  tour: () => { closeDialog(); startTour(tourCtx); },
  reset: () => { if (!confirm('Replace your whole library and variables with the sample APIs? Export a backup first if you need it.')) return; S.caps = {}; replaceWorkspace(sampleWorkspace()); closeDialog(); renderAll(); },
  'new-env': () => { const e = { id: uid(), name: 'New environment', vars: [{ k: 'baseUrl', v: 'https://' }] }; S.ws.envs.push(e); S.ws.activeEnvId = e.id; S.lib = 'vars'; markDirty(); renderAll(); focusEnd('[data-env-name]'); },
  'del-env': () => { const e = env(); if (!confirm(`Delete environment “${e.name}”?`)) return; S.ws.envs = S.ws.envs.filter((x) => x !== e); S.ws.activeEnvId = S.ws.envs[0]?.id || null; markDirty(); renderAll(); },
  'add-var': () => { env().vars.push({ k: '', v: '' }); markDirty(); renderLib(); focusEnd(`[data-v="${env().vars.length - 1}.k"]`); },
  'rm-var': (el) => { env().vars.splice(+el.dataset.i, 1); markDirty(); renderLib(); },
  'clear-hist': () => { S.history = []; saveHistory(); renderLib(); },
  'clear-caps': () => { S.caps = {}; renderLib(); },
  'run-all': runAll,
  restore: () => { replaceWorkspace(pendingDraft); pendingDraft = null; $('#restore').hidden = true; renderAll(); toast('Restored — press Save to keep it'); },
  discard: () => { discardDraft(); pendingDraft = null; $('#restore').hidden = true; },
  'tour-next': () => { if (tourNext()) finishTour(); },
  'tour-back': tourBack,
  'tour-skip': () => finishTour(),
  'tour-theme': (el) => { LS.set('theme', el.dataset.k); applyTheme(); rerenderStep(); },
  'tour-save': (el) => { LS.set('autosave', el.dataset.k); renderSave(); rerenderStep(); },
  'tour-finish': (el) => finishTour(el.dataset.k),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    const lib = $('#lib');
    if (lib.classList.contains('open') && !e.target.closest('#lib')) { lib.classList.remove('open'); renderRail(); }
    if (e.target === $('#dlg')) closeDialog();
    return;
  }
  const fn = A[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => toast(err.message));
});

// ---------- inputs ----------
function updateTest(r, i, tf, val) {
  const t = r.tests[i];
  if (tf === 'type') {
    r.tests[i] = { status: { status: 200 }, jsonpath: { jsonpath: '$.', exists: true }, header: { header: 'content-type' }, maxDurationMs: { maxDurationMs: 1000 } }[val];
    return renderReq();
  }
  if ('status' in t) t.status = Number(val) || val;
  else if ('maxDurationMs' in t) t.maxDurationMs = Number(val) || val;
  else if ('jsonpath' in t) {
    if (tf === 'a') t.jsonpath = val;
    else if (!val.trim()) { delete t.equals; t.exists = true; }
    else { delete t.exists; try { t.equals = JSON.parse(val); } catch { t.equals = val; } }
  } else if ('header' in t) {
    if (tf === 'a') t.header = val;
    else if (val) t.contains = val; else delete t.contains;
  }
}
document.addEventListener('input', (e) => {
  const t = e.target, d = t.dataset, r = cur();
  if (t.classList.contains('search')) return filterLib(t.value);
  if (d.f && r) {
    setPath(r, d.f, t.type === 'checkbox' ? t.checked : t.value);
    markDirty();
    if (d.f === 'name' || d.f === 'folder') { renderTabs(); renderLib(); }
    if (d.f === 'method') { renderTabs(); renderLib(); renderComposer(); renderReq(); }
    if (t.type === 'checkbox') renderReq();
    const u = $('#resolvedUrl'); if (u) u.textContent = resolvedUrl(r);
    if (d.f === 'body.content') { const h = $('#jsonHint'); if (h) h.innerHTML = jsonHint(t.value); }
    return;
  }
  if (d.new && r) { r[d.new].push({ k: t.value, v: '', on: true }); markDirty(); renderReq(); focusEnd(`[data-f="${d.new}.${r[d.new].length - 1}.k"]`); return; }
  if (d.v !== undefined && env()) { const [i, f] = d.v.split('.'); env().vars[+i][f] = t.type === 'checkbox' ? t.checked : t.value; markDirty(); if (f === 'secret') renderLib(); return; }
  if ('envName' in d && env()) { env().name = t.value; markDirty(); renderHeader(); return; }
  if (d.test !== undefined && r) { updateTest(r, +d.test, d.tf, t.value); markDirty(); return; }
  if (d.cap !== undefined && r) {
    const ent = Object.entries(r.capture);
    ent[+d.cap][d.cf === 'k' ? 0 : 1] = t.value;
    r.capture = Object.fromEntries(ent); markDirty(); return;
  }
  if ('wsName' in d) { S.ws.name = t.value; markDirty(); renderLib(); return; }
  if ('wsToken' in d) { S.ws.auth = { ...S.ws.auth, token: t.value }; markDirty(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'envSel') { S.ws.activeEnvId = t.value || null; markDirty(); renderAll(); }
  if ('wsAuth' in t.dataset) { S.ws.auth = { ...S.ws.auth, type: t.value }; markDirty(); openSettings(); }
  if (t.id === 'fileIn' && t.files[0]) {
    const f = t.files[0];
    t.value = '';
    if (f.size > 20 * 1024 * 1024) return toast('That file is too large (max 20 MB)');
    const id = importText(await f.text());
    if (id) openReq(id); else renderAll();
  }
});

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (tourOpen()) { if (e.key === 'Escape') finishTour(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); send(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save().then(() => toast('Saved on this device')); }
  else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); S.lib = 'lib'; if (innerWidth <= 980) $('#lib').classList.add('open'); renderRail(); renderLib(); $('.search')?.focus(); }
  else if (e.key === 'Enter' && e.target.classList.contains('url')) send();
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=tab][data-act]:not(button)')) { e.preventDefault(); e.target.click(); }
});

// ---------- lifecycle ----------
addEventListener('beforeunload', (e) => { if (S.dirty && !autosaveOn()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { renderRail(); renderRes(); }, 150); });

let pendingDraft = null;
function showRestore(draft) {
  pendingDraft = draft;
  const when = new Date(draft.savedAt || Date.now()).toLocaleString();
  $('#restore').innerHTML = `<span>💾 You have unsaved changes from <b>${when}</b>.</span><span class="grow"></span><button class="btn sm primary" data-act="restore">Restore</button><button class="btn sm ghost" data-act="discard">Discard</button>`;
  $('#restore').hidden = false;
}

if ('serviceWorker' in navigator && location.protocol === 'https:' && !isAgentOrigin()) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

(async function init() {
  applyTheme();
  $('#logo').innerHTML = icon('vane', 18);
  const { draft } = await loadState(sampleWorkspace);
  const saved = LS.get('engine');
  S.engine = 'browser';
  renderAll();
  if (draft) showRestore(draft);
  if (!LS.get('onboarded')) startTour(tourCtx);
  const [ext, ag] = await Promise.all([detectExtension(), detectAgent()]);
  if (isAgentOrigin() && ag) S.engine = 'agent';
  else if (saved && ENGINES[saved].available()) S.engine = saved;
  else if (!saved && ext) S.engine = 'ext';
  renderAll();
})();
