import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse, stringify, interpolate, resolveRequest, missingVars, maskSecrets, newRequest,
  getPath, runTests, capture, runSecurity, parseCurl, toCurl, importPostman, workspaceToFiles, filesToWorkspace,
} from '../packages/core/src/index.js';

test('yaml: round-trips every shape we emit', () => {
  const obj = {
    name: 'Create user', method: 'POST', url: '{{baseUrl}}/users',
    headers: { Authorization: 'Bearer {{token}}', 'Content-Type': 'application/json' },
    body: { type: 'json', content: { name: 'Yousaf', n: 1, ok: true, nested: { a: [1, 2] } } },
    tests: [{ status: 201 }, { jsonpath: '$.id', exists: true }, { header: 'content-type', contains: 'application/json' }, { maxDurationMs: 800 }],
    capture: { userId: '$.id' }, multi: 'line1\nline2\n', multi2: 'a\nb', empty: [], emptyObj: {}, nul: null,
    str: 'true', num: '42', colon: 'a: b', hash: 'x #y', quote: 'it\'s "q"', path: '/users', neg: -3.5,
  };
  assert.deepEqual(parse(stringify(obj)), obj);
});

test('yaml: reads hand-written files with comments and flow values', () => {
  const doc = parse(`# request
name: Create user
method: POST
url: "{{baseUrl}}/users"
headers:
  Authorization: "Bearer {{token}}"
body:
  type: json            # json | form
  content: { "name": "Yousaf" }
tests:
  - status: 201
  - jsonpath: "$.id"
    exists: true
capture:
  userId: '$.id'        # saved for later
`);
  assert.equal(doc.body.type, 'json');
  assert.deepEqual(doc.body.content, { name: 'Yousaf' });
  assert.deepEqual(doc.tests, [{ status: 201 }, { jsonpath: '$.id', exists: true }]);
  assert.equal(doc.capture.userId, '$.id');
});

test('yaml: rejects tabs and bad indentation with a line number', () => {
  assert.throws(() => parse('a:\n\tb: 1'), /tabs/);
  assert.throws(() => parse('a: 1\n   b: 2'), /line 2/);
});

test('interpolate: vars, spaces, unknowns, env refs', () => {
  assert.equal(interpolate('{{a}}-{{ b }}-{{c}}', { a: 1, b: 'x' }), '1-x-{{c}}');
  assert.equal(interpolate('${env:TOKEN_X}', {}, { TOKEN_X: 'h' }), 'h');
  assert.equal(interpolate('${env:TOKEN_X}', {}), '${env:TOKEN_X}');
});

test('resolveRequest: query merge, disabled params, bearer', () => {
  const r = newRequest({ url: '{{base}}/users?x=1', params: [{ k: 'q', v: '{{term}}', on: true }, { k: 'off', v: '1', on: false }], auth: { type: 'bearer', token: '{{tok}}' } });
  const x = resolveRequest(r, { base: 'https://api.test', term: 'a b', tok: 'T' });
  assert.equal(x.url, 'https://api.test/users?x=1&q=a%20b');
  assert.equal(x.headers.Authorization, 'Bearer T');
  assert.equal(x.body, undefined);
});

test('resolveRequest: basic, api key in query, inherit, bodies, scheme', () => {
  assert.equal(resolveRequest(newRequest({ url: 'https://a.test', auth: { type: 'basic', username: 'u', password: 'p' } })).headers.Authorization, 'Basic dTpw');
  assert.equal(resolveRequest(newRequest({ url: 'https://x.test/a', auth: { type: 'apikey', key: 'api_key', value: 'K', in: 'query' } })).url, 'https://x.test/a?api_key=K');
  assert.equal(resolveRequest(newRequest({ url: 'https://x.test', auth: { type: 'inherit' } }), {}, { collectionAuth: { type: 'bearer', token: 'C' } }).headers.Authorization, 'Bearer C');
  const j = resolveRequest(newRequest({ method: 'POST', url: 'https://x.test', body: { type: 'json', content: '{"a":"{{v}}"}' } }), { v: 1 });
  assert.equal(j.body, '{"a":"1"}');
  assert.equal(j.headers['Content-Type'], 'application/json');
  const f = resolveRequest(newRequest({ method: 'POST', url: 'https://x.test', body: { type: 'form', content: 'a=1\nb = x y' } }));
  assert.equal(f.body, 'a=1&b=x%20y');
  assert.equal(resolveRequest(newRequest({ url: 'example.com/x' })).url, 'https://example.com/x');
  assert.equal(resolveRequest(newRequest({ method: 'GET', url: 'https://x.test', body: { type: 'json', content: '{}' } })).body, undefined);
});

test('missingVars + maskSecrets', () => {
  assert.deepEqual(missingVars(resolveRequest(newRequest({ url: '{{nope}}/x' }))), ['nope']);
  assert.equal(maskSecrets('token=abc123', ['abc123']), 'token=••••••');
  assert.equal(maskSecrets('ab', ['ab']), 'ab');
});

test('getPath: dots, indexes, quoted keys, invalid', () => {
  const o = { a: { b: [{ c: 5 }] }, 'weird key': 1 };
  assert.equal(getPath(o, '$.a.b[0].c'), 5);
  assert.equal(getPath(o, '$'), o);
  assert.equal(getPath(o, "$['weird key']"), 1);
  assert.equal(getPath(o, 'a.b'), undefined);
  assert.equal(getPath(o, '$.a.x.y'), undefined);
});

test('runTests: pass, fail, hidden header', () => {
  const res = { status: 200, headers: { 'content-type': 'application/json' }, json: { id: 1, name: 'x' }, ms: 50 };
  const out = runTests([{ status: 200 }, { jsonpath: '$.id', exists: true }, { jsonpath: '$.name', equals: 'x' }, { header: 'content-type', contains: 'json' }, { maxDurationMs: 100 }], res);
  assert.ok(out.every((t) => t.ok === true), JSON.stringify(out));
  assert.equal(runTests([{ status: 201 }], res)[0].ok, false);
  assert.equal(runTests([{ jsonpath: '$.nope', exists: false }], res)[0].ok, true);
  assert.equal(runTests([{ header: 'x-secret' }], res, { headersVisible: false })[0].ok, null);
});

test('capture: json path and header', () => {
  assert.deepEqual(capture({ token: '$.t', id: 'header:x-id', none: '$.missing' }, { headers: { 'x-id': '9' }, json: { t: 'abc' } }), { token: 'abc', id: '9' });
});

test('security rules', () => {
  const res = (headers = {}, text = '') => ({ status: 200, headers, text });
  const ids = runSecurity({ url: 'http://api.example.com/x?api_key=1', res: res() }).findings.map((f) => f.id);
  assert.ok(ids.includes('SEC007') && ids.includes('SEC008'));
  const hidden = runSecurity({ url: 'https://a.test', res: res() }, { headersVisible: false });
  assert.ok(hidden.skipped.includes('SEC001') && hidden.skipped.includes('SEC006'));
  const cors = runSecurity({ url: 'https://a.test', res: res({ 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }) });
  assert.equal(cors.findings[0].id, 'SEC002');
  assert.equal(cors.findings[0].severity, 'high');
  assert.equal(runSecurity({ url: 'https://a.test', res: res({}, 'key AKIAABCDEFGHIJKLMNOP') }).findings[0].id, 'SEC003');
  assert.deepEqual(runSecurity({ url: 'http://a.test', res: res() }, { rules: 'off' }).findings, []);
  const cookie = runSecurity({ url: 'https://a.test', res: res({ 'set-cookie': 'sid=1; Path=/' }) }).findings.find((f) => f.id === 'SEC006');
  assert.match(cookie.title, /Secure/);
});

test('cURL import and export', () => {
  const r = parseCurl(`curl -X POST 'https://api.test/users?limit=2' -H 'Content-Type: application/json' -H "Authorization: Bearer abc" --data-raw '{"name":"x"}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.test/users');
  assert.deepEqual(r.params, [{ k: 'limit', v: '2', on: true }]);
  assert.equal(r.headers.length, 2);
  assert.equal(r.body.type, 'json');
  assert.equal(r.body.content, '{\n  "name": "x"\n}');
  const b = parseCurl('curl https://a.test \\\n  -u user:pa:ss');
  assert.equal(b.method, 'GET');
  assert.deepEqual(b.auth, { type: 'basic', username: 'user', password: 'pa:ss' });
  assert.throws(() => parseCurl('ls -la'));
  const c = toCurl({ method: 'POST', url: 'https://a.test/x', headers: { A: "it's" }, body: '{}' });
  assert.match(c, /-X POST/);
  assert.ok(c.includes(`'A: it'\\''s'`));
  assert.ok(c.includes(`--data-raw '{}'`));
});

test('Postman v2.1 import', () => {
  const p = importPostman({
    info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { name: 'Folder', item: [{ name: 'Get', request: { method: 'GET', header: [{ key: 'X', value: '1' }], url: { raw: '{{base}}/a?x=1', query: [{ key: 'x', value: '1' }] }, auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] } } }] },
      { name: 'Post', request: { method: 'POST', url: 'https://b.test', body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } } },
    ],
    variable: [{ key: 'base', value: 'https://a.test' }],
  });
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[0].folder, 'Folder');
  assert.equal(p.requests[0].url, '{{base}}/a');
  assert.deepEqual(p.requests[0].params, [{ k: 'x', v: '1', on: true }]);
  assert.deepEqual(p.requests[0].auth, { type: 'bearer', token: '{{tok}}' });
  assert.equal(p.requests[1].folder, 'General');
  assert.equal(p.requests[1].body.type, 'json');
  assert.equal(p.envs[0].vars[0].k, 'base');
  assert.throws(() => importPostman({ hello: 1 }));
});

test('workspace <-> .apivane files round trip; secrets never written', () => {
  const ws = {
    name: 'T',
    envs: [{ name: 'Staging', vars: [{ k: 'base', v: 'https://s.test' }, { k: 'key', v: 'secret-val', secret: true }] }],
    requests: [
      newRequest({ folder: 'users', name: 'List users', url: '{{base}}/users', params: [{ k: 'limit', v: '2', on: true }], tests: [{ status: 200 }] }),
      newRequest({ folder: 'users', name: 'Create', method: 'POST', url: '{{base}}/users', body: { type: 'json', content: '{"a":1}' }, capture: { id: '$.id' } }),
    ],
  };
  const files = workspaceToFiles(ws);
  const paths = files.map((f) => f.path);
  assert.deepEqual(paths, ['apivane.yaml', 'environments/staging.yaml', 'requests/users/01-list-users.yaml', 'requests/users/02-create.yaml']);
  const envFile = files[1].content;
  assert.ok(!envFile.includes('secret-val'));
  assert.ok(envFile.includes('${env:KEY}'));
  const back = filesToWorkspace(files);
  assert.deepEqual(back.errors, []);
  assert.equal(back.name, 'T');
  assert.equal(back.requests[0].name, 'List users');
  assert.deepEqual(back.requests[0].params, [{ k: 'limit', v: '2', on: true }]);
  assert.deepEqual(JSON.parse(back.requests[1].body.content), { a: 1 });
  assert.deepEqual(back.requests[1].capture, { id: '$.id' });
  assert.deepEqual(back.envs[0].vars.find((v) => v.k === 'key'), { k: 'key', v: '${env:KEY}', secret: true });
  const broken = filesToWorkspace([{ path: 'requests/a/x.yaml', content: 'name: x' }]);
  assert.equal(broken.errors.length, 1);
});
