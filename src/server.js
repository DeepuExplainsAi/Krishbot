import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, save, flush, transcript, uid, now, libraryDir, safe } from './store.js';
import { addClient, emit } from './hub.js';
import * as A from './agent.js';
import { PRESETS, presetsWithStatus } from './presets.js';
import { CATALOG } from './catalog.js';
import { connectMcp, closeMcp, mcpSpec } from './tools.js';
import { nextRun, normalize } from './routines.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'web', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const token = crypto.randomBytes(24).toString('hex');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const body = (req) => new Promise((ok, no) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(new HttpError(400, 'Bad request')); } }); });
const json = (res, data, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const need = (x, msg = 'Not found') => { if (!x) throw new HttpError(404, msg); return x; };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const publicApp = (c, values) => {
  const connected = !!state.apps[c.slug];
  return { slug: c.slug, name: c.name, description: c.description, categories: c.categories, managedAuth: false, noAuth: c.fields.length === 0 && !connected ? false : false, connected, needs: c.fields.map(({ key, label, secret }) => ({ key, label, secret })), values: connected && values ? Object.fromEntries(c.fields.filter((f) => !f.secret).map((f) => [f.key, state.apps[c.slug].values[f.key] ?? ''])) : undefined };
};
const allApps = () => [
  ...CATALOG.map((c) => publicApp(c, true)),
  ...state.customApps.map((a) => ({ slug: a.slug, name: a.name, description: a.description || (a.kind === 'http' ? `${a.method} ${a.url}` : 'Custom MCP server'), categories: ['custom'], managedAuth: false, noAuth: false, connected: true, custom: true, needs: [] })),
];

function listFiles(botId, rel) {
  const root = libraryDir(botId);
  const dir = path.resolve(root, rel || '.');
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new HttpError(400, 'Bad path');
  fs.mkdirSync(root, { recursive: true });
  const files = fs.readdirSync(dir, { withFileTypes: true }).map((d) => { const st = fs.statSync(path.join(dir, d.name)); return { name: d.name, size: st.size, modifiedAt: st.mtimeMs, isDir: d.isDirectory() }; })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.modifiedAt - a.modifiedAt);
  return { status: 'ok', path: rel || '', files };
}

async function api(req, res, url) {
  const m = req.method, p = url.pathname.replace(/^\/api/, '');
  let r;
  const ok = (data = { ok: true }) => json(res, data);

  if (p === '/events' && m === 'GET') return addClient(res);
  if (p === '/auth/me') return ok({ user: { id: 'me', email: '', name: state.settings.userName || 'You', avatarUrl: null }, devLogin: false });
  if (p === '/auth/logout') return ok();
  if (p === '/health') return ok();

  // ---- bots ----
  if (p === '/bots' && m === 'GET') return ok({ bots: state.bots, live: state.bots.map((b) => A.getLive(b.id)) });
  if (p === '/bots' && m === 'POST') { const b = await body(req); if (!String(b.name || '').trim()) throw new HttpError(400, 'Name required'); return ok({ bot: A.createBot(b) }); }
  if ((r = p.match(/^\/bots\/([\w-]+)$/))) {
    const b = need(A.bot(r[1]));
    if (m === 'PATCH') { Object.assign(b, pick(await body(req), ['name', 'label', 'description', 'instructions', 'avatarShape', 'avatarColor', 'effort', 'mode', 'voice', 'voiceSpeed', 'voiceLanguage', 'pinned'])); A.publishBot(b); return ok({ bot: b }); }
    if (m === 'DELETE') { if (b.isPrimary) throw new HttpError(400, 'The primary Bot can’t be deleted'); A.deleteBot(b.id); return ok(); }
  }
  if ((r = p.match(/^\/bots\/([\w-]+)\/(read|rows|messages|interrupt|fresh|primary|settings|routines|tasks|skills|engine|files|handback)(?:\/(.*))?$/))) {
    const [, id, what, rest] = r, b = need(A.bot(id));
    if (what === 'read') { b.unread = 0; A.publishBot(b); return ok(); }
    if (what === 'rows') { const t = transcript(id); return ok({ generation: t.generation, rows: t.rows }); }
    if (what === 'messages') {
      const { text } = await body(req);
      if (!String(text || '').trim()) throw new HttpError(400, 'Empty message');
      if (!A.maybeAnswerPending(id, text)) A.runTurn(id, text).catch(() => {});
      return ok({ row: { botId: id } });
    }
    if (what === 'interrupt') { A.interrupt(id); return ok(); }
    if (what === 'fresh') { A.freshChat(id); return ok(); }
    if (what === 'primary') { state.bots.forEach((x) => (x.isPrimary = x.id === id)); save(); emit({ type: 'roster' }); return ok(); }
    if (what === 'handback') return ok();
    if (what === 'settings') return ok({
      memories: state.memories.filter((x) => x.botId === id), skills: state.skills.filter((x) => x.botId === id), routines: state.routines.filter((x) => x.botId === id),
      tasks: state.tasks.filter((x) => x.botId === id), memory: A.memoryStats(id),
    });
    if (what === 'routines') return ok({ routines: state.routines.filter((x) => x.botId === id) });
    if (what === 'tasks') return ok({ tasks: state.tasks.filter((x) => x.botId === id) });
    if (what === 'skills' && m === 'POST') { const s = await body(req); const skill = { id: uid('skl_'), botId: id, name: s.name, description: s.description || '', body: s.body || '', createdAt: now(), updatedAt: now() }; state.skills.push(skill); save(); return ok({ skill }); }
    if (what === 'files') {
      if (rest === 'download') { const { path: rel } = await body(req); return ok({ url: `/api/bots/${id}/file?path=${encodeURIComponent(rel)}` }); }
      return ok(listFiles(id, url.searchParams.get('path') || ''));
    }
    if (what === 'engine') {
      if (m === 'PATCH') { const { provider, model } = await body(req); if (provider !== undefined) b.provider = provider || null; if (model !== undefined) b.model = model || null; A.publishBot(b); }
      const conn = A.resolveConnection(b);
      return ok({ engine: { botId: id, profile: 'local', status: conn ? 'ready' : 'error', error: conn ? null : 'No model is connected yet. Open Settings → Models.', model: conn?.model ?? b.model, provider: conn?.id ?? b.provider, version: null, providers: A.providerList(), ownScreen: false } });
    }
  }
  if ((r = p.match(/^\/bots\/([\w-]+)\/file$/)) && m === 'GET') {
    const root = libraryDir(r[1]), f = path.resolve(root, url.searchParams.get('path') || '');
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) throw new HttpError(404, 'No such file');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
    return fs.createReadStream(f).pipe(res);
  }
  if ((r = p.match(/^\/bots\/([\w-]+)\/cards\/(\d+)\/(answer|dismiss)$/)) && m === 'POST') {
    if (r[3] === 'answer') A.answerQuestion(r[1], Number(r[2]), String((await body(req)).answer ?? '')); else A.answerQuestion(r[1], Number(r[2]), '', 'dismissed');
    return ok();
  }
  if ((r = p.match(/^\/bots\/([\w-]+)\/(engine\/(restart|screen\/stop|login)|screen\/reset)$/)) && m === 'POST') return ok({ engine: { botId: r[1], profile: 'local', status: 'ready', error: null, model: null, provider: null, version: null, providers: A.providerList(), ownScreen: false } });

  // ---- approvals, policies ----
  if ((r = p.match(/^\/approvals\/([\w-]+)$/)) && m === 'POST') { A.decide(r[1], (await body(req)).decision); return ok(); }
  if (p === '/policies') return ok({ policies: state.policies });
  if ((r = p.match(/^\/policies\/(.+)$/)) && m === 'DELETE') { state.policies = state.policies.filter((x) => x.tool !== decodeURIComponent(r[1])); save(); return ok(); }

  // ---- memories, skills, routines, tasks ----
  if ((r = p.match(/^\/memories\/([\w-]+)$/)) && m === 'DELETE') { const x = state.memories.find((y) => y.id === r[1]); state.memories = state.memories.filter((y) => y.id !== r[1]); save(); if (x) emit({ type: 'memories', botId: x.botId }); return ok(); }
  if ((r = p.match(/^\/skills\/([\w-]+)$/))) {
    const s = need(state.skills.find((x) => x.id === r[1]));
    if (m === 'DELETE') { state.skills = state.skills.filter((x) => x !== s); save(); return ok(); }
    if (m === 'PATCH') { Object.assign(s, pick(await body(req), ['name', 'description', 'body']), { updatedAt: now() }); save(); return ok({ skill: s }); }
  }
  if ((r = p.match(/^\/routines\/([\w-]+)(\/run)?$/))) {
    const rt = need(state.routines.find((x) => x.id === r[1]));
    if (r[2] && m === 'POST') { A.runRoutineNow(rt); return ok(); }
    if (m === 'DELETE') { A.removeRoutine(rt.id); return ok(); }
    if (m === 'PATCH') { const { enabled } = await body(req); rt.enabled = !!enabled; rt.nextRunAt = enabled ? nextRun(rt.schedule) : null; save(); emit({ type: 'routines', botId: rt.botId }); return ok({ routine: rt }); }
  }
  if (p === '/tasks') return ok({ tasks: state.tasks });

  // ---- rooms ----
  if (p === '/rooms' && m === 'POST') { const { name, botIds } = await body(req); const room = A.createBot({ name }, { kind: 'room', mode: 'teammate' }); state.members[room.id] = botIds || []; save(); emit({ type: 'roster' }); return ok({ id: room.id }); }
  if ((r = p.match(/^\/rooms\/([\w-]+)\/members$/))) {
    if (m === 'PUT') { state.members[r[1]] = (await body(req)).botIds || []; save(); return ok({ ok: true, members: state.members[r[1]] }); }
    return ok({ members: (state.members[r[1]] ?? []).map(A.bot).filter(Boolean).map((b) => ({ id: b.id, name: b.name, label: b.label, avatarShape: b.avatarShape, avatarColor: b.avatarColor })) });
  }

  // ---- computer: always "awake" (it is this computer) ----
  if (p === '/computer' || p === '/computer/ensure' || p === '/computer/suspend') return ok({ computer: { status: 'running', orgoId: null, error: null, screens: [] } });

  // ---- apps (MCP servers and HTTP APIs) ----
  if (p === '/apps' && m === 'GET') {
    const search = (url.searchParams.get('search') || '').toLowerCase(), cat = url.searchParams.get('category') || '';
    const apps = allApps().filter((a) => (!search || `${a.name} ${a.description}`.toLowerCase().includes(search)) && (!cat || a.categories.includes(cat)));
    return ok({ apps, connectedApps: allApps().filter((a) => a.connected), connected: allApps().filter((a) => a.connected).map((a) => a.slug), categories: [...new Set(allApps().flatMap((a) => a.categories))], total: apps.length });
  }
  if (p === '/apps/custom' && m === 'POST') {
    const a = await body(req);
    if (!a.name || !(a.url || a.command)) throw new HttpError(400, 'Name and a URL or command are required');
    const slug = `c_${safe(a.name).toLowerCase()}`;
    const app = { ...pick(a, ['name', 'description', 'kind', 'url', 'method', 'headers', 'body', 'command', 'args', 'env']), slug, kind: a.kind === 'http' ? 'http' : 'mcp' };
    if (app.kind === 'mcp') { try { await connectMcp(slug, mcpSpec(app)); } catch (e) { await closeMcp(slug); throw new HttpError(400, `Couldn’t start it: ${e.message}`); } }
    state.customApps = state.customApps.filter((x) => x.slug !== slug).concat(app); save(); emit({ type: 'connections' });
    return ok({ app });
  }
  if ((r = p.match(/^\/apps\/([\w-]+)\/connect$/)) && m === 'POST') {
    const cat = need(CATALOG.find((c) => c.slug === r[1]));
    const values = (await body(req)).values || {};
    const missing = cat.fields.filter((f) => !String(values[f.key] ?? '').trim());
    if (missing.length) throw new HttpError(400, `Fill in: ${missing.map((f) => f.label).join(', ')}`);
    state.apps[cat.slug] = { values }; await closeMcp(cat.slug);
    try { await connectMcp(cat.slug, (await import('./catalog.js')).specFor(cat, values)); } catch (e) { delete state.apps[cat.slug]; await closeMcp(cat.slug); throw new HttpError(400, `Couldn’t start ${cat.name}: ${e.message}. Is Node.js installed?`); }
    save(); emit({ type: 'connections' });
    return ok();
  }
  if ((r = p.match(/^\/apps\/([\w-]+)$/)) && m === 'DELETE') { delete state.apps[r[1]]; state.customApps = state.customApps.filter((x) => x.slug !== r[1]); await closeMcp(r[1]); save(); emit({ type: 'connections' }); return ok(); }

  // ---- models and app settings ----
  if (p === '/models' && m === 'GET') return ok({ presets: presetsWithStatus(), connections: state.connections.map((c) => ({ ...c, apiKey: c.apiKey ? '••••' : '' })) });
  if ((r = p.match(/^\/models\/([\w-]+)$/))) {
    const preset = need(PRESETS.find((x) => x.id === r[1]));
    if (m === 'DELETE') { state.connections = state.connections.filter((c) => c.id !== preset.id); save(); emit({ type: 'roster' }); return ok(); }
    if (m === 'PUT') {
      const v = pick(await body(req), ['apiKey', 'baseUrl', 'model', 'command', 'trust']);
      const prev = state.connections.find((c) => c.id === preset.id) ?? {};
      if (v.apiKey === '••••') delete v.apiKey;
      state.connections = state.connections.filter((c) => c.id !== preset.id).concat({ id: preset.id, ...prev, ...v });
      save(); emit({ type: 'roster' }); return ok();
    }
  }
  if (p === '/models/test' && m === 'POST') {
    const b = await body(req);
    try { const conn = { ...need(PRESETS.find((x) => x.id === b.id)), ...b }; const reply = await (await import('./providers.js')).callModel(conn, 'Reply with the single word: ok', [{ role: 'user', content: 'ping' }], [], { signal: AbortSignal.timeout(90_000) }); return ok({ ok: true, reply: reply.text.slice(0, 80) }); }
    catch (e) { return json(res, { error: e.message }, 400); }
  }
  if (p === '/settings') {
    if (m === 'PATCH') { Object.assign(state.settings, pick(await body(req), ['autoApprove', 'userName'])); save(); }
    return ok({ settings: state.settings });
  }
  throw new HttpError(404, 'Not found');
}

export function start(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
      if (url.searchParams.get('t') === token) { res.writeHead(302, { location: '/', 'set-cookie': `kb=${token}; HttpOnly; SameSite=Strict; Path=/` }); return res.end(); }
      if (!(req.headers.cookie || '').includes(`kb=${token}`)) { res.writeHead(401); return res.end('Open Krishbot from its app window.'); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      let file = path.join(pub, path.normalize(url.pathname));
      if (!file.startsWith(pub)) { res.writeHead(403); return res.end(); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(pub, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(500); return res.end('The app files are missing. Run: npm run build'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      const status = e.status || 500;
      if (!res.headersSent) json(res, { error: e.message }, status); else res.end();
    }
  });
  setInterval(() => A.tickRoutines(), 20_000).unref();
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/?t=${token}` })));
}

process.on('SIGINT', () => { flush(); process.exit(0); });
if (process.argv[1] === fileURLToPath(import.meta.url)) start(Number(process.env.PORT || 8787)).then(({ url }) => console.log('Krishbot:', url));
