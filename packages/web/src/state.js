// App state + persistence rules.
// - First visit: the sample workspace (not saved until the user changes something).
// - Autosave ON (default): every change is saved ~0.5 s later.
// - Autosave OFF: user saves with the Save button / Ctrl+S; a recovery draft is still written,
//   so if they forget, the next visit offers "Restore unsaved changes".
import { maskSecrets } from '../core/index.js';
import * as store from './store.js';
import { LS } from './dom.js';

export const S = {
  ws: null, activeId: null, openIds: [], reqTab: 'params', resTab: 'body', lib: 'lib', mview: 'req',
  results: {}, caps: {}, history: [], engine: 'browser', dirty: false, sending: new Set(), view: 'pretty',
};

export const SECRET_NAME = /token|secret|passw|apikey|api_key|auth/i;
export const cur = () => S.ws.requests.find((r) => r.id === S.activeId);
export const env = () => S.ws.envs.find((e) => e.id === S.ws.activeEnvId);
export function vars() {
  const o = {};
  for (const v of env()?.vars || []) if (v.k) o[v.k] = v.v;
  return { ...o, ...S.caps };
}
export function secrets() {
  return [
    ...(env()?.vars || []).filter((v) => v.secret && v.v).map((v) => v.v),
    ...Object.entries(S.caps).filter(([k]) => SECRET_NAME.test(k)).map(([, v]) => String(v)),
  ];
}
export const mask = (s) => maskSecrets(s, secrets());
export const autosaveOn = () => LS.get('autosave', '1') === '1';

const listeners = [];
export const onSaveState = (fn) => listeners.push(fn);
const emit = () => listeners.forEach((f) => f());
let timer;

export function markDirty() {
  S.dirty = true;
  emit();
  clearTimeout(timer);
  timer = setTimeout(autosaveOn() ? save : saveDraft, autosaveOn() ? 500 : 1200);
}
export async function save() {
  clearTimeout(timer);
  S.ws.savedAt = Date.now();
  await store.set('workspace', S.ws);
  await store.del('draft');
  S.dirty = false;
  emit();
  store.persistStorage();
}
async function saveDraft() { await store.set('draft', { ...S.ws, savedAt: Date.now() }); }
/** Write pending changes now (tab hidden / closing). */
export function flush() {
  if (!S.dirty) return;
  clearTimeout(timer);
  return autosaveOn() ? save() : saveDraft();
}
export const saveHistory = () => store.set('history', S.history.slice(0, 100));

export async function loadState(sample) {
  const [ws, draft, hist] = await Promise.all([store.get('workspace'), store.get('draft'), store.get('history')]);
  S.ws = ws || sample();
  S.history = Array.isArray(hist) ? hist : [];
  const newerDraft = draft && (!ws || (draft.savedAt || 0) > (ws.savedAt || 0)) ? draft : null;
  if (!S.ws.envs.some((e) => e.id === S.ws.activeEnvId)) S.ws.activeEnvId = S.ws.envs[0]?.id || null;
  S.activeId = S.ws.requests[0]?.id || null;
  S.openIds = S.activeId ? [S.activeId] : [];
  return { draft: newerDraft, firstVisit: !ws };
}
export function replaceWorkspace(ws, { dirty = true } = {}) {
  S.ws = ws;
  S.results = {};
  if (!S.ws.envs.some((e) => e.id === S.ws.activeEnvId)) S.ws.activeEnvId = S.ws.envs[0]?.id || null;
  S.activeId = S.ws.requests[0]?.id || null;
  S.openIds = S.activeId ? [S.activeId] : [];
  if (dirty) markDirty();
}
export const discardDraft = () => store.del('draft');
