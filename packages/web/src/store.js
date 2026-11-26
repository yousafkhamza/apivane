// Browser-only persistence (no login): IndexedDB with a localStorage fallback.
// Keys: "workspace" (saved), "draft" (recovery copy when autosave is off), "history".
const DB = 'apivane', STORE = 'kv';
let dbp;

function open() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('no indexedDB'));
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export async function get(key) {
  try { return await tx('readonly', (s) => s.get(key)); }
  catch { try { return JSON.parse(localStorage.getItem('apivane.db.' + key) || 'null') ?? undefined; } catch { return undefined; } }
}
export async function set(key, value) {
  const plain = JSON.parse(JSON.stringify(value));
  try { await tx('readwrite', (s) => s.put(plain, key)); }
  catch { localStorage.setItem('apivane.db.' + key, JSON.stringify(plain)); }
}
export async function del(key) {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { localStorage.removeItem('apivane.db.' + key); }
}

/** Ask the browser not to evict our data under storage pressure (silently ignored if refused). */
export async function persistStorage() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ }
}
