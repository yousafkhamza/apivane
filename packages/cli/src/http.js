// Outgoing HTTP for the agent and the CI runner (Node's built-in fetch). Size + time limited.
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_TEXT = 5 * 1024 * 1024;

export class HttpError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export function validateRequest(p) {
  if (!p || typeof p !== 'object') throw new HttpError('invalid', 'Request body must be a JSON object');
  const method = String(p.method || '').toUpperCase();
  if (!METHODS.includes(method)) throw new HttpError('invalid', `Unsupported method "${p.method}"`);
  let u;
  try { u = new URL(p.url); } catch { throw new HttpError('url', `Invalid URL "${p.url}"`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError('url', 'Only http and https URLs are allowed');
  const headers = {};
  for (const [k, v] of Object.entries(p.headers || {})) headers[String(k)] = String(v);
  if (p.body !== undefined && p.body !== null && typeof p.body !== 'string') throw new HttpError('invalid', 'body must be a string');
  return { method, url: u.href, headers, body: p.body ?? undefined, timeoutMs: Math.min(Math.max(Number(p.timeoutMs) || 30000, 1000), 300000) };
}

/** @returns {Promise<{status:number,statusText:string,headers:Record<string,string>,text:string,binary:boolean,size:number,truncated:boolean,ms:number,ttfb:number,url:string}>} */
export async function doFetch(input, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const r = validateRequest(input);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs);
  const t0 = performance.now();
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.method === 'GET' || r.method === 'HEAD' ? undefined : r.body, redirect: 'follow', signal: ctl.signal });
    const t1 = performance.now();
    const chunks = [];
    let size = 0;
    if (resp.body) {
      for await (const c of resp.body) {
        size += c.byteLength;
        if (size > maxBytes) { ctl.abort(); throw new HttpError('too-large', `Response is larger than ${Math.round(maxBytes / 1048576)} MB`); }
        chunks.push(c);
      }
    }
    const t2 = performance.now();
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const headers = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const cookies = resp.headers.getSetCookie?.() || [];
    if (cookies.length) headers['set-cookie'] = cookies.join('\n');
    const ct = headers['content-type'] || '';
    const textLike = !ct || /json|text|xml|javascript|html|x-www-form-urlencoded|graphql|yaml|csv/i.test(ct);
    return {
      status: resp.status, statusText: resp.statusText, headers, url: resp.url || r.url, size,
      binary: !textLike, text: textLike ? buf.subarray(0, MAX_TEXT).toString('utf8') : '', truncated: size > MAX_TEXT,
      ms: Math.round(t2 - t0), ttfb: Math.round(t1 - t0),
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e.name === 'AbortError') throw new HttpError('timeout', `No answer after ${Math.round(r.timeoutMs / 1000)} seconds`);
    const cause = e.cause?.code || e.cause?.message || e.message;
    throw new HttpError('blocked', `Could not reach ${new URL(r.url).host}: ${cause}`);
  } finally { clearTimeout(timer); }
}
