// Local agent: request proxy + .apivane/ file storage + serves the web UI.
// Security: loopback bind by default, random token on every start, Host + Origin allowlists,
// Private Network Access preflights answered only for allowed origins.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { doFetch } from './http.js';
import { readCollection, writeCollection } from './files.js';

export const DEFAULT_ORIGINS = ['https://yousafkhamza.github.io'];
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const MAX_BODY = 12 * 1024 * 1024;

export const newToken = () => randomBytes(24).toString('base64url');

function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Body must be JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

/**
 * @param {{token:string, collectionDir:string, webDir?:string, allowOrigins?:string[], version?:string}} opts
 */
export function createAgent(opts) {
  const allowed = new Set([...DEFAULT_ORIGINS, ...(opts.allowOrigins || [])].map((o) => o.replace(/\/+$/, '')));
  const originOk = (o) => LOOPBACK_ORIGIN.test(o) || allowed.has(o);

  return http.createServer(async (req, res) => {
    const send = (status, body, extra = {}) => {
      const json = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(json);
    };
    try {
      // DNS-rebinding guard: only loopback host names are accepted.
      if (!LOOPBACK_HOST.test(req.headers.host || '')) return send(421, { error: 'Host not allowed' });
      const origin = req.headers.origin;
      const cors = {};
      if (origin) {
        if (!originOk(origin)) return send(403, { error: `Origin ${origin} is not allowed. Start the agent with --allow-origin ${origin}` });
        cors['Access-Control-Allow-Origin'] = origin;
        cors.Vary = 'Origin';
      }
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'OPTIONS') {
        const h = { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-ApiVane-Token', 'Access-Control-Max-Age': '600' };
        if (origin && req.headers['access-control-request-private-network'] === 'true') h['Access-Control-Allow-Private-Network'] = 'true';
        res.writeHead(204, h);
        return res.end();
      }

      if (url.pathname.startsWith('/api/')) {
        if (!sameToken(req.headers['x-apivane-token'], opts.token)) return send(401, { error: 'Missing or wrong token', kind: 'agent-token' }, cors);
        if (url.pathname === '/api/health' && req.method === 'GET') return send(200, { ok: true, version: opts.version || '0.0.0', project: path.resolve(opts.collectionDir) }, cors);
        if (url.pathname === '/api/send' && req.method === 'POST') {
          const body = await readBody(req);
          try { return send(200, await doFetch(body), cors); }
          catch (e) { return send(e.kind === 'invalid' || e.kind === 'url' ? 400 : 502, { error: e.message, kind: e.kind || 'blocked' }, cors); }
        }
        if (url.pathname === '/api/collection' && req.method === 'GET') return send(200, { files: await readCollection(opts.collectionDir) }, cors);
        if (url.pathname === '/api/collection' && req.method === 'PUT') {
          const body = await readBody(req);
          try { return send(200, await writeCollection(opts.collectionDir, body.files), cors); }
          catch (e) { return send(e.kind === 'path' ? 400 : 500, { error: e.message, kind: e.kind || 'agent' }, cors); }
        }
        return send(404, { error: 'Not found' }, cors);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Method not allowed' }, cors);
      return serveStatic(opts.webDir, url.pathname, res);
    } catch (e) {
      if (!res.headersSent) send(e.status || 500, { error: e.message });
    }
  });
}

async function serveStatic(webDir, pathname, res) {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-cache' };
  if (!webDir) { res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ApiVane agent is running. The web UI is not bundled in this build.'); }
  const base = path.resolve(webDir);
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(base, '.' + rel);
  if (full !== base && !full.startsWith(base + path.sep)) { res.writeHead(404, headers); return res.end(); }
  let data;
  try { data = await fs.readFile(full); } catch { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const ext = path.extname(full).toLowerCase();
  if (ext === '.html') data = Buffer.from(data.toString('utf8').replace('<!--agent-->', '<meta name="apivane-agent" content="1">'));
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  res.end(data);
}
