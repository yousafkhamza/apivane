import { $, esc } from '../dom.js';
import { S, autosaveOn } from '../state.js';
import { ENGINES, agent, isAgentOrigin } from '../engines.js';
import { LS } from '../dom.js';

export const STORE_LINKS = {
  chrome: 'https://github.com/yousafkhamza/apivane/releases/latest',
  firefox: 'https://github.com/yousafkhamza/apivane/releases/latest',
};

export function openDialog(title, html) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = html;
  const d = $('#dlg');
  if (!d.open) d.showModal();
}
export const closeDialog = () => $('#dlg').open && $('#dlg').close();

export function engineChoices() {
  const ext = ENGINES.ext.available(), ag = ENGINES.agent.available();
  const c = (k, ic, name, desc, status, extra = '') => `<button class="choice" data-act="engine-pick" data-k="${k}" aria-pressed="${S.engine === k}"><span class="ic">${ic}</span><strong>${name}</strong><span class="pill ${status[1] ? '' : 'off'}">${status[0]}</span><small>${desc}</small></button>${extra}`;
  return c('browser', '🌐', 'Browser only', 'Nothing to install. Works with public APIs that allow it, like the samples. Some headers stay hidden.', ['Ready', true]) +
    c('ext', '🧩', 'Browser extension', 'Chrome, Edge, Firefox. No CORS limit and every response header is visible.', ext ? [`v${ENGINES.ext.info().version} detected`, true] : ['Not installed', false],
      ext ? '' : `<div class="cmd"><span>Get it: <a href="${STORE_LINKS.chrome}" target="_blank" rel="noopener">Chrome / Edge</a> · <a href="${STORE_LINKS.firefox}" target="_blank" rel="noopener">Firefox</a></span><button class="btn sm" data-act="ext-recheck">Check again</button></div>`) +
    c('agent', '⌘', 'Local agent', 'Saves collections as files in your repo and runs them in CI. Localhost only, token-protected.', ag ? ['Connected', true] : ['Not connected', false],
      ag || isAgentOrigin() ? '' : `<div class="box" style="display:grid;gap:8px"><div class="cmd"><span>npx apivane-cli</span><button class="btn sm" data-act="copy" data-text="npx apivane-cli">Copy</button></div>
        <div class="grid2"><label class="field">Agent address<input id="agentUrl" value="${esc(agent.base)}" spellcheck="false"></label><label class="field">Token from terminal<input id="agentToken" type="password" value="${esc(agent.token)}" autocomplete="off" spellcheck="false"></label></div>
        <button class="btn primary" data-act="agent-connect">Connect</button></div>`);
}

export function openEngineDialog() {
  openDialog('Who sends your requests?', `<p class="muted" style="margin:0">Browsers block many API calls from websites. Pick how far you want to go — your requests and variables stay the same.</p>${engineChoices()}`);
}

export function openSettings() {
  const theme = LS.get('theme', 'system');
  const auth = S.ws.auth || { type: 'none' };
  openDialog('Settings', `
    <div class="switch"><div><b>Autosave</b><small>${autosaveOn() ? 'Every change is saved on this device automatically.' : 'Save with the Save button or Ctrl+S. A recovery copy is still kept if you forget.'}</small></div>
      <div class="seg"><button data-act="set-autosave" data-k="1" aria-pressed="${autosaveOn()}">On</button><button data-act="set-autosave" data-k="0" aria-pressed="${!autosaveOn()}">Off</button></div></div>
    <div class="switch"><div><b>Appearance</b><small>“Device” follows your phone or laptop setting.</small></div>
      <div class="seg">${[['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-act="set-theme" data-k="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div></div>
    <div class="switch"><div><b>Collection name</b><small>Shown in the library and in saved files.</small></div><input class="inp" data-ws-name value="${esc(S.ws.name || '')}" aria-label="Collection name"></div>
    <div class="switch"><div><b>Collection auth</b><small>Used by requests set to “Inherit”.</small></div>
      <select class="inp" data-ws-auth aria-label="Collection auth">${['none', 'bearer'].map((k) => `<option value="${k}" ${auth.type === k ? 'selected' : ''}>${k === 'none' ? 'None' : 'Bearer token'}</option>`).join('')}</select></div>
    ${auth.type === 'bearer' ? `<label class="field">Collection bearer token<input class="inp" data-ws-token value="${esc(auth.token || '')}" placeholder="{{token}}" spellcheck="false"></label>` : ''}
    <div class="switch"><div><b>Backup &amp; move devices</b><small>No account: your data lives in this browser. Export a file to keep it safe or open it elsewhere.</small></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn sm" data-act="export">Export</button><button class="btn sm" data-act="import">Import</button></div></div>
    <label class="hint" style="margin:0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="expSecrets"> Include 🔒 secret values in the export file</label>
    ${ENGINES.agent.available() ? `<div class="switch"><div><b>Repo files (.apivane/)</b><small>${esc(agent.info.project || '')}</small></div><div style="display:flex;gap:6px"><button class="btn sm" data-act="repo-load">Load</button><button class="btn sm primary" data-act="repo-save">Save to repo</button></div></div>` : ''}
    <div class="switch"><div><b>Walkthrough</b><small>See the intro again.</small></div><button class="btn sm" data-act="tour">Replay</button></div>
    <div class="switch"><div><b>Start over</b><small>Replace everything with the sample APIs.</small></div><button class="btn sm danger" data-act="reset">Reset</button></div>`);
}

export function openImport() {
  openDialog('Import', `<p class="muted" style="margin:0">Paste a <b>cURL</b> command, a <b>Postman</b> collection (v2.1 JSON) or an <b>ApiVane</b> backup.</p>
    <textarea class="code" id="importText" placeholder="curl https://api.example.com/users -H 'Accept: application/json'" spellcheck="false" aria-label="Paste here"></textarea>
    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><button class="btn" data-act="import-file">Choose a file…</button><button class="btn primary" data-act="import-paste">Import</button></div>
    <p class="hint" style="margin:0">Postman and cURL imports are added to your library. A backup replaces it (you’ll be asked first).</p>`);
}

export function openRunReport(rows) {
  const pass = rows.filter((r) => r.ok).length;
  openDialog(`Run finished: ${pass}/${rows.length} passed`, rows.map((r) => `<div class="row"><span class="tag ${r.ok ? 't-pass' : 't-fail'}">${r.ok ? 'PASS' : 'FAIL'}</span><div style="flex:1"><a href="#" data-act="open" data-id="${r.id}">${esc(r.name)}</a><div class="muted" style="font-size:12.5px">${esc(r.detail)}</div></div><span class="mono muted">${r.ms ?? '–'} ms</span></div>`).join('') +
    '<p class="hint">Same run in CI: <span class="mono">npx apivane-cli run --reporter junit</span></p>');
}
