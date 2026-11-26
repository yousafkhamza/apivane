// Declarative tests, captures and a tiny JSONPath subset ($, .key, [0], ['key']).

export function getPath(obj, path) {
  const p = String(path).trim();
  if (p !== '$' && !p.startsWith('$.') && !p.startsWith('$[')) return undefined;
  const parts = [];
  const re = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]/g;
  let m, last = 1;
  while ((m = re.exec(p))) {
    if (m.index !== last) return undefined;
    parts.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : m[3]));
    last = re.lastIndex;
  }
  if (last !== p.length) return undefined;
  return parts.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/** Human label for a test, same wording in UI, CLI and reports. */
export function testLabel(t) {
  if ('status' in t) return `status is ${t.status}`;
  if ('jsonpath' in t) {
    if ('equals' in t) return `${t.jsonpath} equals ${JSON.stringify(t.equals)}`;
    if ('contains' in t) return `${t.jsonpath} contains "${t.contains}"`;
    return `${t.jsonpath} ${t.exists === false ? 'is missing' : 'exists'}`;
  }
  if ('header' in t) return 'contains' in t ? `header ${t.header} contains "${t.contains}"` : `header ${t.header} exists`;
  if ('maxDurationMs' in t) return `responds in under ${t.maxDurationMs} ms`;
  return 'unknown test';
}

const short = (v) => (v === undefined ? 'missing' : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 60));

/**
 * @param {object[]} tests
 * @param {{status:number, headers:Record<string,string>, json:unknown, ms:number}} res
 * @param {{headersVisible?:boolean}} [opts]
 */
export function runTests(tests = [], res, opts = {}) {
  return tests.map((t) => {
    const name = testLabel(t);
    if ('status' in t) return { name, ok: res.status === Number(t.status), got: String(res.status) };
    if ('jsonpath' in t) {
      const v = res.json === undefined || res.json === null ? undefined : getPath(res.json, t.jsonpath);
      if ('equals' in t) return { name, ok: JSON.stringify(v) === JSON.stringify(t.equals), got: short(v) };
      if ('contains' in t) return { name, ok: v !== undefined && JSON.stringify(v).includes(String(t.contains)), got: short(v) };
      const want = t.exists !== false;
      return { name, ok: (v !== undefined) === want, got: short(v) };
    }
    if ('header' in t) {
      const v = res.headers[String(t.header).toLowerCase()];
      if (v === undefined && opts.headersVisible === false) return { name, ok: null, got: 'hidden by browser' };
      return { name, ok: v !== undefined && ('contains' in t ? v.includes(String(t.contains)) : true), got: short(v) };
    }
    if ('maxDurationMs' in t) return { name, ok: res.ms <= Number(t.maxDurationMs), got: `${res.ms} ms` };
    return { name, ok: false, got: 'unknown test type' };
  });
}

/** Values to save into run variables, e.g. { token: '$.accessToken' }. */
export function capture(spec = {}, res) {
  const out = {};
  for (const [name, path] of Object.entries(spec)) {
    const p = String(path);
    const v = p.startsWith('header:') ? res.headers[p.slice(7).trim().toLowerCase()] : getPath(res.json, p);
    if (v !== undefined) out[name] = typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
