import { $, esc, kb } from '../dom.js';
import { S, cur } from '../state.js';
import { SAMPLE_INFO } from '../samples.js';

const TABS = [['body', 'Response'], ['headers', 'Headers'], ['tests', 'Tests'], ['security', 'Security'], ['timing', 'Timing']];
const BIG = 300 * 1024;

export function hlJson(v) {
  return esc(JSON.stringify(v, null, 2)).replace(
    /(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (m, s, c, b) => s ? (c ? `<span class="jk">${s}</span>${c}` : `<span class="js">${s}</span>`) : b ? `<span class="jb">${m}</span>` : m === 'null' ? `<span class="jz">${m}</span>` : `<span class="jn">${m}</span>`);
}

export function renderRes() {
  const r = cur(), out = r && S.results[r.id], el = $('#resBody');
  const nT = out?.tests ? out.tests.filter((t) => t.ok === true).length : 0;
  const tCls = !out?.tests ? '' : out.tests.some((t) => t.ok === false) ? 'bad' : 'good';
  const nS = out?.sec ? out.sec.findings.length : 0;
  const sCls = !out?.sec ? '' : out.sec.findings.some((f) => f.severity === 'high' || f.severity === 'medium') ? 'bad' : 'good';
  const badge = (k) => k === 'tests' && out?.tests ? `<span class="n ${tCls}">${nT}/${out.tests.length}</span>` : k === 'security' && out?.sec ? `<span class="n ${sCls}">${nS}</span>` : '';
  const res = out?.res;
  const summary = res ? `<span class="status st${String(res.status)[0]}">${res.status} ${esc(res.statusText || '')}</span><span class="metric">${res.ms} ms</span><span class="metric">${kb(res.size)}</span>`
    : out?.error ? '<span class="status sterr">Not sent</span>' : '';
  $('#resTabs').innerHTML = TABS.map(([k, l]) => `<button role="tab" data-act="res-tab" data-k="${k}" aria-selected="${S.resTab === k}">${l}${badge(k)}</button>`).join('') + `<div class="summary">${summary}</div>`;

  if (!r) { el.innerHTML = ''; return; }
  if (!out) { el.innerHTML = emptyState(); return; }
  if (out.error) { el.innerHTML = errorCard(out.error); return; }
  const phoneBar = innerWidth <= 720 ? `<div class="resbar">${summary}</div>` : '';
  const t = S.resTab;
  if (t === 'body') el.innerHTML = phoneBar + bodyView(out);
  else if (t === 'headers') el.innerHTML = (res.headersVisible ? '' : '<div class="callout"><b>!</b><span>The browser only shows headers the API chooses to share. <a href="#" data-act="engine">Connect the extension</a> to see all of them.</span></div>') +
    `<table class="kv"><tr><th>Header</th><th>Value</th></tr>${Object.entries(res.headers).map(([k, v]) => `<tr><td><input type="text" value="${esc(k)}" readonly></td><td><input type="text" value="${esc(v)}" readonly></td></tr>`).join('')}</table>`;
  else if (t === 'tests') el.innerHTML = out.tests.length ? out.tests.map((x) => `<div class="row"><span class="tag ${x.ok === true ? 't-pass' : x.ok === false ? 't-fail' : 't-skip'}">${x.ok === true ? 'PASS' : x.ok === false ? 'FAIL' : 'SKIP'}</span><span style="flex:1">${esc(x.name)}</span><span class="mono muted">${esc(x.got)}</span></div>`).join('')
    + (out.captured?.length ? `<p class="hint">Saved for next requests: ${out.captured.map((k) => `<span class="var">{{${esc(k)}}}</span>`).join(' ')}</p>` : '')
    : '<p class="hint">No checks on this request. Add some in the request’s <b>Tests</b> tab.</p>';
  else if (t === 'security') el.innerHTML = (out.sec.skipped.length ? `<div class="callout"><b>!</b><span>${out.sec.skipped.join(', ')} skipped — the browser hides most headers. <a href="#" data-act="engine">Connect the extension</a> for a full scan.</span></div>` : '') +
    (out.sec.off ? '<p class="hint">Security checks are off for this request.</p>' : out.sec.findings.length ? out.sec.findings.map((f) => `<div class="row"><span class="tag t-${f.severity}">${f.severity.toUpperCase()}</span><div style="flex:1"><div>${esc(f.title)} <span class="mono muted">${f.id}</span></div><div class="muted" style="font-size:12.5px">Fix: ${esc(f.fix)}</div></div></div>`).join('')
      : '<div class="row"><span class="tag t-clean">CLEAN</span><span>No problems found by the checks that ran.</span></div>');
  else {
    const T = Math.max(res.ms, 1), bar = (l, v, c) => `<div class="timing"><span class="muted">${l}</span><div class="bar"><i style="width:${Math.max(2, (v / T) * 100)}%;background:${c}"></i></div><span class="mono">${v} ms</span></div>`;
    el.innerHTML = bar('Waiting', res.ttfb, 'var(--blue)') + bar('Download', Math.max(0, res.ms - res.ttfb), 'var(--patina)') + bar('Total', res.ms, 'var(--copper)') +
      `<p class="hint">Final URL: <span class="mono">${esc(res.url)}</span></p>`;
  }
}

function bodyView(out) {
  const res = out.res;
  if (res.binary) return `<p class="hint">Binary response (${esc(res.headers['content-type'] || 'unknown type')}, ${kb(res.size)}). Preview isn’t shown.</p>`;
  if (!res.text) return '<p class="hint">Empty body.</p>';
  const pretty = S.view === 'pretty' && out.json !== undefined;
  const tools = `<div class="resbar"><div class="seg" role="group"><button data-act="view" data-k="pretty" aria-pressed="${S.view === 'pretty'}">Pretty</button><button data-act="view" data-k="raw" aria-pressed="${S.view === 'raw'}">Raw</button></div><button class="btn sm" data-act="copy-body">Copy</button>${res.truncated ? '<span class="metric">showing first 5 MB</span>' : ''}</div>`;
  if (pretty) return tools + `<pre class="json">${res.text.length > BIG ? esc(JSON.stringify(out.json, null, 2)) : hlJson(out.json)}</pre>`;
  return tools + `<pre class="json">${esc(res.text.slice(0, 2_000_000))}</pre>`;
}

function emptyState() {
  const samples = S.ws.requests.filter((r) => SAMPLE_INFO[r.name]).slice(0, 8);
  return `<div style="text-align:center;padding:16px 0 4px"><b>Press Send</b> <span class="muted">or</span> <span class="mono">Ctrl + Enter</span></div>` +
    (samples.length ? `<div class="hello"><h3>Or try a free public API</h3><p class="muted" style="margin:0">No keys, no sign-up. Each one shows a different feature.</p><div class="gallery">${samples.map((r) => `<button class="sample" data-act="open" data-id="${r.id}"><b><span class="m ${r.method}">${r.method}</span> ${esc(r.name)}</b><span>${esc(SAMPLE_INFO[r.name])}</span></button>`).join('')}</div></div>` : '');
}

function errorCard(e) {
  const fixes = `<p><b>Fix it in one step:</b></p><ol><li><a href="#" data-act="engine">Add the ApiVane extension</a> (Chrome, Edge, Firefox)</li><li>or run <code>npx apivane</code> on your computer</li><li>or <a href="#" data-act="curl">copy as cURL</a> and run it in a terminal</li></ol>`;
  switch (e.kind) {
    case 'var': {
      const login = S.ws.requests.find((r) => Object.keys(r.capture || {}).some((k) => e.missing.includes(k)));
      return `<div class="box err"><h3>A variable has no value</h3><p>${e.missing.map((m) => `<span class="var">{{${esc(m)}}}</span>`).join(', ')} ${e.missing.length > 1 ? 'are' : 'is'} empty in this environment.</p>` +
        (login ? `<p>👉 Run <a href="#" data-act="open" data-id="${login.id}"><b>${esc(login.name)}</b></a> first — it saves the value for you.</p>` : '<p class="muted">Add it under <a href="#" data-act="rail" data-k="vars">Vars</a>, or switch environment.</p>') + '</div>';
    }
    case 'url': return `<div class="box err"><h3>That URL doesn’t look right</h3><p class="muted">${esc(e.message)}</p></div>`;
    case 'timeout': return '<div class="box err"><h3>No answer after 30 seconds</h3><p class="muted">The server may be down or slow. Check the URL and try again.</p></div>';
    case 'invalid': return `<div class="box err"><h3>The browser refused this request</h3><p class="muted">${esc(e.message)}</p><p>Usually a header name or value with characters that aren’t allowed.</p></div>`;
    case 'agent-down': return '<div class="box err"><h3>Local agent isn’t running</h3><p>Start it with <code>npx apivane</code>, or <a href="#" data-act="engine">switch engine</a>.</p></div>';
    case 'agent-token': return '<div class="box err"><h3>Agent token needed</h3><p>Paste the token printed in your terminal into <a href="#" data-act="engine">Connect</a>.</p></div>';
    case 'blocked': {
      const why = e.insecure ? 'This page is secure (https), so the browser blocks plain <code>http://</code> calls.'
        : e.local ? 'Websites aren’t allowed to call <code>localhost</code> or private-network APIs directly.'
          : 'The API didn’t allow calls from websites (<b>CORS</b>). The browser hides the exact reason, so it could also be a typo, DNS, or a certificate problem.';
      return `<div class="box err"><h3>The browser blocked this request</h3><p>${why}</p>${S.engine === 'browser' ? fixes : `<p class="muted">${esc(e.message)}</p>`}</div>`;
    }
    default: return `<div class="box err"><h3>Request failed</h3><p class="muted">${esc(e.message || 'Unknown error')}</p></div>`;
  }
}
