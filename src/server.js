import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, saveConfig, getChat, clearChat } from './store.js';
import { runTurn, answerApproval } from './agent.js';
import { testMcp } from './tools.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const token = crypto.randomBytes(24).toString('hex');

const body = (req) => new Promise((ok, no) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });
const json = (res, data, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === 'GET' && p === '/api/config') return json(res, getConfig());
  if (m === 'PUT' && p === '/api/config') { saveConfig(await body(req)); return json(res, { ok: true }); }
  if (m === 'POST' && p === '/api/approve') { const b = await body(req); answerApproval(String(b.id), !!b.ok); return json(res, { ok: true }); }
  if (m === 'POST' && p === '/api/mcp/test') { try { return json(res, { tools: await testMcp(await body(req)) }); } catch (e) { return json(res, { error: e.message }, 400); } }
  const chat = p.match(/^\/api\/chat\/([\w-]+)$/);
  if (chat && m === 'GET') return json(res, getChat(chat[1]).filter((x) => x.role !== 'tool').map((x) => ({ role: x.role, content: x.content })).filter((x) => x.content));
  if (chat && m === 'DELETE') { clearChat(chat[1]); return json(res, { ok: true }); }
  if (chat && m === 'POST') {
    const { text } = await body(req);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try { await runTurn(chat[1], text, emit, ctl.signal); } catch (e) { emit({ type: 'error', text: e.message }); }
    emit({ type: 'done' });
    return res.end();
  }
  json(res, { error: 'not found' }, 404);
}

export function start(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      // Only this machine, only with the session token (blocks other websites and other users).
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
      if (url.searchParams.get('t') === token) {
        res.writeHead(302, { location: '/', 'set-cookie': `kb=${token}; HttpOnly; SameSite=Strict; Path=/` });
        return res.end();
      }
      if (!(req.headers.cookie || '').includes(`kb=${token}`)) { res.writeHead(401); return res.end('Open Krishbot from its app window.'); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const file = path.join(pub, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(pub) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { if (!res.headersSent) json(res, { error: e.message }, 500); else res.end(); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/?t=${token}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start(Number(process.env.PORT || 8787)).then(({ url }) => console.log('Krishbot:', url));
