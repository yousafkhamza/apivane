export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export const LS = {
  get: (k, d = null) => { try { return localStorage.getItem('apivane.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('apivane.' + k, v); } catch { /* private mode */ } },
};
export const SS = {
  get: (k) => { try { return sessionStorage.getItem('apivane.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem('apivane.' + k) : sessionStorage.setItem('apivane.' + k, v); } catch { /* ignore */ } },
};

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function copy(text, msg = 'Copied') {
  return navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Your browser blocked copying'));
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Set obj[path] where path is "params.0.k" */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

const ICONS = {
  lib: 'M4 5h6v14H4zM14 5h6v6h-6zM14 15h6v4h-6z',
  vars: 'M5 7h14M5 12h14M5 17h9',
  hist: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4l3 2',
  plug: 'M9 3v4M15 3v4M7 7h10v5a5 5 0 0 1-10 0zM12 17v4',
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  req: 'M5 12h12M13 7l5 5-5 5',
  res: 'M4 6h16v12H4zM8 10h8M8 14h5',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  dup: 'M8 8h12v12H8zM4 16V4h12',
  vane: 'M12 10v11M4 10h16M20 10l-3-2.5M20 10l-3 2.5M4 10 2 7.5M4 10l-2 2.5',
};
export const icon = (n, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;
