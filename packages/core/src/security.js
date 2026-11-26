// Rule-based security checks run on every response. No AI, no network.
// Each rule: id, title, check(ctx) -> [{severity, title, fix}]

export const SEVERITIES = ['info', 'low', 'medium', 'high'];
export const rank = (s) => SEVERITIES.indexOf(s);

const isLocal = (u) => /^https?:\/\/(localhost|127\.|\[::1\])/i.test(u);
const isHtml = (h) => (h['content-type'] || '').includes('text/html');

export const RULES = [
  {
    id: 'SEC001', title: 'Security headers', needsHeaders: true,
    check({ url, res }) {
      const h = res.headers, out = [];
      if (url.startsWith('https:') && !h['strict-transport-security'])
        out.push({ severity: 'medium', title: 'No Strict-Transport-Security header', fix: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains' });
      if (!h['x-content-type-options'])
        out.push({ severity: 'low', title: 'No X-Content-Type-Options header', fix: 'Send X-Content-Type-Options: nosniff' });
      if (isHtml(h) && !h['content-security-policy'])
        out.push({ severity: 'medium', title: 'HTML without Content-Security-Policy', fix: 'Add a Content-Security-Policy header' });
      if (isHtml(h) && !h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] || ''))
        out.push({ severity: 'low', title: 'Page can be framed (clickjacking)', fix: "Send X-Frame-Options: DENY or CSP frame-ancestors 'none'" });
      return out;
    },
  },
  {
    id: 'SEC002', title: 'CORS policy',
    check({ res, origin }) {
      const h = res.headers, acao = h['access-control-allow-origin'], creds = h['access-control-allow-credentials'] === 'true';
      if (acao === '*' && creds) return [{ severity: 'high', title: 'CORS allows any site with credentials', fix: 'Return a specific allowed origin, never * with credentials' }];
      if (origin && acao === origin && creds && origin === 'null') return [{ severity: 'high', title: 'CORS trusts the "null" origin with credentials', fix: 'Never allow the null origin' }];
      return [];
    },
  },
  {
    id: 'SEC003', title: 'Secrets in response',
    check({ res }) {
      const t = res.text + '\n' + Object.values(res.headers).join('\n');
      if (/AKIA[0-9A-Z]{16}/.test(t)) return [{ severity: 'high', title: 'AWS access key in response', fix: 'Remove credentials from responses and rotate the key' }];
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) return [{ severity: 'high', title: 'Private key in response', fix: 'Remove it and rotate the key' }];
      if (/\b(gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{16,})/.test(t)) return [{ severity: 'high', title: 'API token (GitHub/Slack/Stripe) in response', fix: 'Remove it and rotate the token' }];
      if (/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]+/.test(t)) return [{ severity: 'info', title: 'JWT in response', fix: 'Expected on login endpoints; make sure other endpoints do not return tokens' }];
      return [];
    },
  },
  {
    id: 'SEC005', title: 'Verbose errors',
    check({ res }) {
      const out = [];
      if (/\bat [\w.$<>]+ \([^)]*:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread "|\bat [\w.$]+\([\w]+\.java:\d+\)/.test(res.text))
        out.push({ severity: 'medium', title: 'Stack trace in response', fix: 'Return a generic error message in production' });
      const server = res.headers['server'] || '', xp = res.headers['x-powered-by'] || '';
      if (/\d+\.\d+/.test(server) || xp) out.push({ severity: 'low', title: `Server version disclosed (${(xp || server).slice(0, 40)})`, fix: 'Hide version banners (Server, X-Powered-By)' });
      return out;
    },
  },
  {
    id: 'SEC006', title: 'Cookie flags', needsHeaders: true,
    check({ res }) {
      const c = res.headers['set-cookie'];
      if (!c) return [];
      const miss = ['Secure', 'HttpOnly', 'SameSite'].filter((f) => !new RegExp(`;\\s*${f}`, 'i').test(c));
      return miss.length ? [{ severity: 'medium', title: `Cookie missing ${miss.join(', ')}`, fix: 'Set Secure; HttpOnly; SameSite=Lax (or Strict) on session cookies' }] : [];
    },
  },
  {
    id: 'SEC007', title: 'Plain HTTP',
    check({ url }) {
      return url.startsWith('http:') && !isLocal(url) ? [{ severity: 'high', title: 'Request sent over plain http://', fix: 'Use https://' }] : [];
    },
  },
  {
    id: 'SEC008', title: 'Secrets in URL',
    check({ url }) {
      let q;
      try { q = [...new URL(url).searchParams.keys()]; } catch { return []; }
      const bad = q.find((k) => /token|secret|passw|api[_-]?key|^key$|auth/i.test(k));
      return bad ? [{ severity: 'medium', title: `Secret-looking "${bad}" in the URL`, fix: 'Send it in a header; URLs end up in logs and browser history' }] : [];
    },
  },
];

/**
 * @param {{url:string, res:{status:number,headers:Record<string,string>,text:string}, origin?:string}} ctx
 * @param {{headersVisible?:boolean, rules?:'default'|'off'|string[]}} [opts]
 */
export function runSecurity(ctx, opts = {}) {
  if (opts.rules === 'off') return { findings: [], skipped: [] };
  const findings = [], skipped = [];
  for (const r of RULES) {
    if (Array.isArray(opts.rules) && !opts.rules.includes(r.id)) continue;
    if (r.needsHeaders && opts.headersVisible === false) { skipped.push(r.id); continue; }
    for (const f of r.check(ctx)) findings.push({ id: r.id, ...f });
  }
  findings.sort((a, b) => rank(b.severity) - rank(a.severity));
  return { findings, skipped };
}
