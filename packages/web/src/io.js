// Import / export / repo sync. Backups never include secret values unless the user ticks the box.
import { $, toast, download, uid } from './dom.js';
import { S, markDirty, replaceWorkspace } from './state.js';
import { parseCurl, importPostman, workspaceToFiles, filesToWorkspace } from '../core/index.js';
import { agentFiles } from './engines.js';
import { closeDialog } from './ui/dialogs.js';

export function normalizeWorkspace(ws) {
  const out = { version: 1, name: ws.name || 'My APIs', auth: ws.auth || { type: 'none' }, activeEnvId: ws.activeEnvId, savedAt: ws.savedAt };
  out.envs = (ws.envs || []).map((e) => ({ id: e.id || uid(), name: e.name || 'Environment', vars: (e.vars || []).map((v) => ({ k: String(v.k ?? ''), v: String(v.v ?? ''), secret: !!v.secret })) }));
  out.requests = (ws.requests || []).map((r) => ({ ...r, id: r.id || uid(), params: r.params || [], headers: r.headers || [], tests: r.tests || [], capture: r.capture || {}, body: r.body || { type: 'none', content: '' }, auth: r.auth || { type: 'inherit' }, folder: r.folder || 'General' }));
  return out;
}

export function exportBackup() {
  const withSecrets = $('#expSecrets')?.checked;
  const ws = JSON.parse(JSON.stringify(S.ws));
  if (!withSecrets) for (const e of ws.envs) for (const v of e.vars) if (v.secret) v.v = '';
  const day = new Date().toISOString().slice(0, 10);
  download(`apivane-backup-${day}.json`, JSON.stringify({ apivane: 'backup', version: 1, exportedAt: new Date().toISOString(), workspace: ws }, null, 2));
  toast(withSecrets ? 'Backup saved — it contains secrets, keep it private' : 'Backup saved (secret values left out)');
}

/** @returns {string|null} id of the first imported request, or null */
export function importText(text, { confirmReplace = (m) => confirm(m) } = {}) {
  const s = text.trim();
  if (!s) { toast('Paste something first'); return null; }
  try {
    if (/^curl(\.exe)?\s/i.test(s)) return addRequests([parseCurl(s)], 'Imported from cURL');
    let j;
    try { j = JSON.parse(s); } catch { toast('That isn’t a cURL command or a JSON file'); return null; }
    if (j?.apivane === 'backup' && j.workspace) {
      if (!confirmReplace('Replace everything in your library with this backup?')) return null;
      replaceWorkspace(normalizeWorkspace(j.workspace));
      closeDialog();
      toast('Backup restored');
      return S.activeId;
    }
    if (j?.info && Array.isArray(j.item)) {
      const p = importPostman(j);
      if (p.envs.length) for (const e of p.envs) S.ws.envs.push({ ...e, id: uid() });
      return addRequests(p.requests, `Imported ${p.requests.length} requests from Postman`);
    }
    toast('Unknown format. Use cURL, Postman v2.1 or an ApiVane backup.');
  } catch (e) { toast(e.message); }
  return null;
}

function addRequests(list, msg) {
  if (!list.length) { toast('Nothing to import'); return null; }
  const added = list.map((r) => ({ ...r, id: uid() }));
  S.ws.requests.push(...added);
  markDirty();
  closeDialog();
  toast(msg);
  return added[0].id;
}

export async function saveToRepo() {
  const files = workspaceToFiles(S.ws);
  const r = await agentFiles.write(files);
  toast(`Saved ${r.written ?? files.length} files to .apivane/`);
}

export async function loadFromRepo() {
  const { files } = await agentFiles.read();
  if (!files?.length) { toast('No .apivane/ files in this folder yet — use “Save to repo” first'); return false; }
  const ws = filesToWorkspace(files);
  if (!confirm(`Load ${ws.requests.length} requests from .apivane/? This replaces your library in this browser.`)) return false;
  replaceWorkspace(normalizeWorkspace({ ...ws, activeEnvId: null }));
  toast(ws.errors.length ? `Loaded with ${ws.errors.length} problem(s): ${ws.errors[0]}` : 'Loaded from repo');
  return true;
}
