import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createAgent } from '../packages/cli/src/agent.js';
import { safePath } from '../packages/cli/src/files.js';
import { runCollection, exitCode } from '../packages/cli/src/run.js';
import { junit, markdown } from '../packages/cli/src/report.js';
import { parseArgs } from '../packages/cli/src/cli.js';
import { writeCollection } from '../packages/cli/src/files.js';
import { workspaceToFiles, newRequest } from '../packages/core/src/index.js';
import { zip } from '../scripts/zip.mjs';

const TOKEN = 'test-token-0123456789abcdef';
let upstream, upPort, agent, agentPort, tmp;

const listen = (srv) => new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
function call(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apivane-test-'));
  fs.mkdirSync(path.join(tmp, 'web'));
  fs.writeFileSync(path.join(tmp, 'web', 'index.html'), '<html><head><!--agent--></head></html>');
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/data') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"hello":"world"}'); }
      if (req.url === '/login' && req.method === 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ token: 'tok123', echo: JSON.parse(body || '{}') })); }
      if (req.url === '/me') {
        const ok = req.headers.authorization === 'Bearer tok123';
        res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(ok ? { user: 'u' } : { error: 'no' }));
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    });
  });
  upPort = await listen(upstream);
  agent = createAgent({ token: TOKEN, collectionDir: path.join(tmp, 'col'), webDir: path.join(tmp, 'web'), version: '9.9.9' });
  agentPort = await listen(agent);
});
after(() => { upstream.close(); agent.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('agent: token required, health works', async () => {
  assert.equal((await call(agentPort, { path: '/api/health' })).status, 401);
  assert.equal((await call(agentPort, { path: '/api/health', headers: { 'X-ApiVane-Token': 'wrong' } })).status, 401);
  const ok = await call(agentPort, { path: '/api/health', headers: { 'X-ApiVane-Token': TOKEN } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json().version, '9.9.9');
});

test('agent: rejects foreign Origin and Host (DNS rebinding)', async () => {
  assert.equal((await call(agentPort, { path: '/api/health', headers: { 'X-ApiVane-Token': TOKEN, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await call(agentPort, { path: '/api/health', headers: { 'X-ApiVane-Token': TOKEN, Host: 'evil.test' } })).status, 421);
});

test('agent: CORS + Private Network Access preflight only for allowed origins', async () => {
  const pre = await call(agentPort, { method: 'OPTIONS', path: '/api/send', headers: { Origin: 'https://yousafkhamza.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'https://yousafkhamza.github.io');
  assert.equal(pre.headers['access-control-allow-private-network'], 'true');
  const bad = await call(agentPort, { method: 'OPTIONS', path: '/api/send', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(bad.status, 403);
});

test('agent: proxies a request', async () => {
  const r = await call(agentPort, { method: 'POST', path: '/api/send', headers: { 'X-ApiVane-Token': TOKEN, 'Content-Type': 'application/json' }, body: { method: 'GET', url: `http://127.0.0.1:${upPort}/data` } });
  assert.equal(r.status, 200);
  const out = r.json();
  assert.equal(out.status, 200);
  assert.deepEqual(JSON.parse(out.text), { hello: 'world' });
  const bad = await call(agentPort, { method: 'POST', path: '/api/send', headers: { 'X-ApiVane-Token': TOKEN }, body: { method: 'GET', url: 'file:///etc/passwd' } });
  assert.equal(bad.status, 400);
});

test('agent: collection files stay inside the folder', async () => {
  const h = { 'X-ApiVane-Token': TOKEN, 'Content-Type': 'application/json' };
  assert.equal((await call(agentPort, { method: 'PUT', path: '/api/collection', headers: h, body: { files: [{ path: '../evil.yaml', content: 'x: 1' }] } })).status, 400);
  const ok = await call(agentPort, { method: 'PUT', path: '/api/collection', headers: h, body: { files: [{ path: 'requests/a/01-x.yaml', content: 'name: x\nurl: "https://a.test"\n' }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json().written, 1);
  const list = (await call(agentPort, { path: '/api/collection', headers: h })).json();
  assert.deepEqual(list.files.map((f) => f.path), ['requests/a/01-x.yaml']);
});

test('agent: serves the UI with the agent marker', async () => {
  const r = await call(agentPort, { path: '/' });
  assert.equal(r.status, 200);
  assert.match(r.body, /name="apivane-agent"/);
  assert.equal((await call(agentPort, { path: '/../../etc/passwd' })).status, 404);
});

test('safePath blocks traversal, absolute paths and non-YAML', () => {
  for (const p of ['/abs.yaml', 'C:/x.yaml', 'a/../../x.yaml', 'x.txt', '', 'a//b.yaml']) assert.throws(() => safePath(tmp, p), /./);
  assert.ok(safePath(tmp, 'requests/a.yaml').endsWith('a.yaml'));
});

test('runner: login -> capture token -> reuse; reports and exit codes', async () => {
  const dir = path.join(tmp, 'runner');
  const ws = {
    name: 'Flow',
    envs: [{ name: 'local', vars: [{ k: 'base', v: `http://127.0.0.1:${upPort}` }] }],
    requests: [
      newRequest({ folder: 'flow', name: 'Login', method: 'POST', url: '{{base}}/login', auth: { type: 'none' }, body: { type: 'json', content: '{"u":"x"}' }, tests: [{ status: 200 }], capture: { token: '$.token' } }),
      newRequest({ folder: 'flow', name: 'Me', url: '{{base}}/me', auth: { type: 'bearer', token: '{{token}}' }, tests: [{ status: 200 }, { jsonpath: '$.user', equals: 'u' }] }),
    ],
  };
  await writeCollection(dir, workspaceToFiles(ws));
  const rep = await runCollection({ dir, env: 'local', security: 'off' });
  assert.deepEqual(rep.results.map((r) => r.ok), [true, true], JSON.stringify(rep.results, null, 2));
  assert.equal(exitCode(rep), 0);

  ws.requests.push(newRequest({ folder: 'z', name: 'Broken', url: '{{base}}/bad', auth: { type: 'none' }, tests: [{ status: 200 }] }));
  await writeCollection(dir, workspaceToFiles(ws));
  const rep2 = await runCollection({ dir, env: 'local', security: 'off' });
  assert.equal(exitCode(rep2), 1);
  assert.match(junit(rep2), /failures="1"/);
  assert.match(markdown(rep2), /2\/3 passed/);

  await assert.rejects(runCollection({ dir, env: 'nope' }), /not found/);
});

test('runner: unset ${env:X} fails clearly', async () => {
  const dir = path.join(tmp, 'runner-env');
  await writeCollection(dir, workspaceToFiles({ name: 'E', envs: [{ name: 'ci', vars: [{ k: 'key', v: 'x', secret: true }] }], requests: [newRequest({ url: 'https://example.invalid' })] }));
  await assert.rejects(runCollection({ dir, env: 'ci', processEnv: {} }), /KEY is not set/);
});

test('cli args', () => {
  assert.deepEqual(parseArgs(['run', '--env', 'dev', '--bail', '--port=9']), { _: ['run'], env: 'dev', bail: true, port: '9' });
  assert.throws(() => parseArgs(['--env']));
});

test('zip writer produces a readable archive', () => {
  const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const csize = z.readUInt32LE(18), nlen = z.readUInt16LE(26);
  assert.equal(zlib.inflateRawSync(z.subarray(30 + nlen, 30 + nlen + csize)).toString(), 'hello');
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
});
