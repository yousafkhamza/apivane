// Reporters: cli (stdout), json, junit (GitHub/GitLab test tabs), markdown (GitHub job summary).
const xml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export function cliLine(r) {
  const head = r.ok ? c(32, '✓') : c(31, '✗');
  const lines = [`${head} ${r.method.padEnd(6)} ${r.folder} / ${r.name}  ${c(2, r.status ? `${r.status} · ${r.ms} ms` : '')}`];
  if (r.error) lines.push(`    ${c(31, r.error)}`);
  for (const t of r.tests) if (t.ok === false) lines.push(`    ${c(31, '✗')} ${t.name} ${c(2, `(got ${t.got})`)}`);
  for (const f of r.findings) if (f.severity !== 'info') lines.push(`    ${c(33, '!')} ${f.id} ${f.severity}: ${f.title}`);
  return lines.join('\n');
}

export function summaryLine(rep) {
  const pass = rep.results.filter((r) => r.ok).length;
  const findings = rep.results.reduce((n, r) => n + r.findings.filter((f) => f.severity !== 'info').length, 0);
  return `\n${pass}/${rep.results.length} requests passed · ${findings} security finding(s) · ${rep.durationMs} ms`;
}

export function junit(rep) {
  const cases = rep.results.map((r) => {
    const fails = [];
    if (r.error) fails.push(r.error);
    for (const t of r.tests) if (t.ok === false) fails.push(`${t.name} (got ${t.got})`);
    const body = fails.length ? `<failure message="${xml(fails[0])}">${xml(fails.join('\n'))}</failure>` : '';
    const sec = r.findings.length ? `<system-out>${xml(r.findings.map((f) => `${f.id} [${f.severity}] ${f.title} — ${f.fix}`).join('\n'))}</system-out>` : '';
    return `    <testcase classname="${xml(r.folder)}" name="${xml(`${r.method} ${r.name}`)}" time="${(r.ms / 1000).toFixed(3)}">${body}${sec}</testcase>`;
  });
  const failures = rep.results.filter((r) => !r.ok).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="ApiVane" tests="${rep.results.length}" failures="${failures}" time="${(rep.durationMs / 1000).toFixed(3)}">\n  <testsuite name="${xml(rep.collection)}" tests="${rep.results.length}" failures="${failures}" timestamp="${rep.startedAt}">\n${cases.join('\n')}\n  </testsuite>\n</testsuites>\n`;
}

export function markdown(rep) {
  const md = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const pass = rep.results.filter((r) => r.ok).length;
  const rows = rep.results.map((r) => {
    const notes = [r.error, ...r.tests.filter((t) => t.ok === false).map((t) => `${t.name} (got ${t.got})`), ...r.findings.filter((f) => f.severity !== 'info').map((f) => `${f.id} ${f.severity}: ${f.title}`)].filter(Boolean);
    return `| ${r.ok ? '✅' : '❌'} | ${md(r.method)} | ${md(`${r.folder} / ${r.name}`)} | ${r.status ?? '–'} | ${r.ms} ms | ${md(notes.join('; ') || '')} |`;
  });
  return `### ApiVane: ${pass}/${rep.results.length} passed${rep.env ? ` (env: ${md(rep.env)})` : ''}\n\n| | Method | Request | Status | Time | Notes |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}
