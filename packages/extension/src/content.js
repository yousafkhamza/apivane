// Bridge between the ApiVane page and the extension background. Only same-window, same-origin messages.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const post = (m) => window.postMessage(m, location.origin);
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.apivane !== 'req' || typeof d.id !== 'string' || !['ping', 'send'].includes(d.action)) return;
    Promise.resolve(api.runtime.sendMessage({ action: d.action, payload: d.payload })).then(
      (res) => post({ apivane: 'res', id: d.id, ok: !!res?.ok, data: res?.data, error: res?.error }),
      (err) => post({ apivane: 'res', id: d.id, ok: false, error: { kind: 'blocked', message: String(err?.message || err) } }),
    );
  });
})();
