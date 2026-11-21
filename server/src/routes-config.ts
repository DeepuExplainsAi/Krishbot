import { Hono } from 'hono';
import { db, now } from './db.js';
import './db-config.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { env } from './env.js';
import { libraryRoot } from './paths.js';
import path from 'node:path';
import { emitBot, getBotRow, listRoutines, listTasks } from './store.js';
import { openTerminal, quote } from './terminal.js';
import { engineHome, engineInfo, engineKind, forgetEngineOptions, restartEngine } from './engine.js';
import { listMemories } from './engine-memory.js';
import type { LibraryFile, Skill } from './types.js';
import { binFound, callModel, forgetBins, listModels, PRESETS, savedConnections, saveConnections, type Conn } from './providers.js';
import { forgetLocalLists } from './engine.js';

/**
 * Bot settings, skills, library and memory maintenance.
 * Mounted next to routes.ts in index.ts; every path here needs a signed-in user.
 */
export const configApi = new Hono<AuthVars>();

for (const p of ['/bots/*', '/skills/*', '/models', '/models/*']) configApi.use(p, requireUser);

const ownBot = (userId: string, id: string) => {
  const b = getBotRow(id);
  return b && b.user_id === userId ? b : null;
};

const toSkill = (s: any): Skill => ({ id: s.id, botId: s.bot_id, name: s.name, description: s.description ?? '', body: s.body, createdAt: s.created_at, updatedAt: s.updated_at ?? s.created_at });
const listSkills = (botId: string) => (db.prepare('SELECT * FROM skills WHERE bot_id=? ORDER BY created_at ASC').all(botId) as any[]).map(toSkill);

// ---------- settings bundle ----------

configApi.get('/bots/:id/settings', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({
    memories: listMemories(b.id),
    skills: listSkills(b.id),
    routines: listRoutines(b.id),
    tasks: listTasks(b.id),
    // The agent keeps its own memory and trims its own context; there is nothing for the app to maintain.
    memory: { lastConsolidatedAt: null, historyChars: 0, compactAtChars: 0, lastCompaction: null },
  });
});

// ---------- skills ----------

function cleanSkill(p: any, partial = false): { name?: string; description?: string; body?: string } | string {
  const out: { name?: string; description?: string; body?: string } = {};
  if (p.name !== undefined || !partial) {
    const name = String(p.name ?? '').trim();
    if (!name) return 'Give the skill a name';
    out.name = name.slice(0, 80);
  }
  if (p.body !== undefined || !partial) {
    const body = String(p.body ?? '').trim();
    if (!body) return 'Write the steps for this skill';
    out.body = body.slice(0, 20_000);
  }
  if (p.description !== undefined) out.description = String(p.description).trim().slice(0, 300);
  return out;
}

configApi.get('/bots/:id/skills', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ skills: listSkills(b.id) }) : c.json({ error: 'not found' }, 404);
});

configApi.post('/bots/:id/skills', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})));
  if (typeof s === 'string') return c.json({ error: s }, 400);
  const id = newId('skl');
  db.prepare('INSERT INTO skills(id,bot_id,name,body,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, b.id, s.name, s.body, s.description ?? '', now(), now());
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(id)) });
});

const ownSkill = (userId: string, id: string) =>
  db.prepare('SELECT s.* FROM skills s JOIN bots b ON b.id=s.bot_id WHERE s.id=? AND b.user_id=?').get(id, userId) as any;

configApi.patch('/skills/:id', async (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})), true);
  if (typeof s === 'string') return c.json({ error: s }, 400);
  db.prepare('UPDATE skills SET name=?, body=?, description=?, updated_at=? WHERE id=?').run(s.name ?? cur.name, s.body ?? cur.body, s.description ?? cur.description ?? '', now(), cur.id);
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(cur.id)) });
});

configApi.delete('/skills/:id', (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  db.prepare('DELETE FROM skills WHERE id=?').run(cur.id);
  return c.json({ ok: true });
});

// ---------- memory maintenance (now the agent's own job; kept so older clients get an answer) ----------

configApi.post('/bots/:id/memories/consolidate', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ added: [], skipped: 0, considered: 0 });
});

configApi.post('/bots/:id/compact', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ itemsBefore: 0, itemsAfter: 0, compacted: false });
});

// ---------- the agent behind a bot: model, sign-in, restart ----------

configApi.get('/bots/:id/engine', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ engine: await engineInfo(b.id, c.req.query('refresh') === '1') });
});

/** Which model this bot's turns ask for. Empty values go back to the agent's own default. */
configApi.patch('/bots/:id/engine', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const p = await c.req.json<{ provider?: string | null; model?: string | null }>().catch(() => ({} as { provider?: string | null; model?: string | null }));
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  if (p.provider !== undefined) db.prepare('UPDATE bots SET provider=?, updated_at=? WHERE id=?').run(clean(p.provider), now(), b.id);
  if (p.model !== undefined) db.prepare('UPDATE bots SET model=?, updated_at=? WHERE id=?').run(clean(p.model), now(), b.id);
  emitBot(b.id);
  return c.json({ engine: await engineInfo(b.id) });
});

/**
 * Sign in to a model provider (a subscription or an API key). Hermes does
 * the sign-in itself; we open its command in a terminal window on this computer, where the user
 * finishes it. If no terminal can be opened the command is returned to run by hand.
 */
configApi.post('/bots/:id/engine/login', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const home = engineHome(b.id);
  if (!home) return c.json({ error: 'This bot has no agent.' }, 409);
  const { provider } = await c.req.json<{ provider?: string }>().catch(() => ({} as { provider?: string }));
  if (provider !== undefined && !/^[a-z0-9][a-z0-9._-]{0,40}$/.test(provider)) return c.json({ error: 'bad provider' }, 400);
  const hermes = `HERMES_HOME=${quote(home)} ${quote(env.hermesBin)}`;
  // Claude subscriptions sign in with OAuth; without the flag Hermes asks for an API key.
  const cmd = !provider ? `${hermes} model` : `${hermes} auth add ${provider}${provider === 'anthropic' ? ' --type oauth' : ''}`;
  const opened = await openTerminal(cmd);
  forgetEngineOptions(b.id);
  return c.json({ ok: true, opened, command: cmd });
});

configApi.post('/bots/:id/engine/restart', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  // The primary agent serves more than this app (its messaging runs through the same process), so it is never restarted from here.
  if (engineKind(b.id) !== 'managed') return c.json({ error: `${b.name} runs on the computer's own agent, which this app does not restart.` }, 409);
  try {
    await restartEngine(b.id);
    forgetEngineOptions(b.id);
    return c.json({ engine: await engineInfo(b.id) });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502);
  }
});

// ---------- library: files under <libraryRoot>/<botId> on the bot's computer (see paths.ts) ----------

function safeRel(p: string | undefined): string | null {
  const rel = (p ?? '').replace(/^\/+|\/+$/g, '');
  if (!rel) return '';
  if (rel.split('/').some((s) => !s || s === '.' || s === '..') || /[\0\n\r]/.test(rel)) return null;
  return rel;
}

configApi.get('/bots/:id/files', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (rel === null) return c.json({ error: 'bad path' }, 400);
  const root = path.join(libraryRoot(), b.id);
  try {
    fs.mkdirSync(root, { recursive: true });
    const files: LibraryFile[] = fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((d) => {
      try { const st = fs.statSync(path.join(root, rel, d.name)); return [{ name: d.name, size: st.size, modifiedAt: st.mtimeMs, isDir: st.isDirectory() }]; } catch { return []; }
    }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.modifiedAt - a.modifiedAt);
    return c.json({ status: 'ok', path: rel, files });
  } catch (e: any) {
    return c.json({ status: 'error', path: rel, files: [], error: String(e?.message ?? e).slice(0, 300) });
  }
});

configApi.post('/bots/:id/files/download', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel((await c.req.json<{ path: string }>().catch(() => ({ path: '' }))).path);
  if (!rel) return c.json({ error: 'bad path' }, 400);
  return c.json({ url: `/api/bots/${b.id}/files/raw?path=${encodeURIComponent(rel)}` });
});

configApi.get('/bots/:id/files/raw', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const root = path.join(libraryRoot(), b.id);
  let file: string;
  try {
    // Follow links before checking, so a link inside the library cannot point outside it.
    file = fs.realpathSync(path.join(root, rel));
    if (!file.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(file).isFile()) throw new Error('outside');
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
  const name = rel.split('/').pop()!;
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(fs.statSync(file).size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-content-type-options': 'nosniff',
    },
  });
});


// ---------- models: direct connections (no agent harness needed) ----------

const mask = (c: Conn) => ({ ...c, apiKey: c.apiKey ? `${c.apiKey.slice(0, 3)}…${c.apiKey.slice(-3)}` : undefined, hasKey: !!c.apiKey });

configApi.get('/models', (c) => {
  forgetBins();
  return c.json({ presets: PRESETS.map((p) => ({ ...p, found: p.bin ? binFound(p.bin) : undefined })), connections: savedConnections().map(mask) });
});

const connFrom = (id: string, b: any, old?: Conn): Conn | string => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return 'Unknown connection.';
  const clean = (v: unknown, n = 500) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined);
  const conn: Conn = {
    id, type: preset.type,
    baseUrl: clean(b.baseUrl) ?? old?.baseUrl ?? preset.baseUrl,
    model: clean(b.model, 200) ?? old?.model ?? preset.model,
    command: clean(b.command) ?? old?.command ?? preset.command,
    trust: typeof b.trust === 'boolean' ? b.trust : old?.trust ?? true,
    apiKey: clean(b.apiKey, 400) || old?.apiKey,
  };
  if (preset.type === 'cli' && !conn.command) return 'Enter the command.';
  if (preset.type === 'openai' && !conn.baseUrl) return 'Enter the base URL.';
  if (preset.needsKey && !conn.apiKey) return 'Paste your API key.';
  return conn;
};

configApi.put('/models/:id', async (c) => {
  const id = c.req.param('id');
  const list = savedConnections();
  const conn = connFrom(id, await c.req.json().catch(() => ({})), list.find((x) => x.id === id));
  if (typeof conn === 'string') return c.json({ error: conn }, 400);
  saveConnections([...list.filter((x) => x.id !== id), conn]);
  forgetLocalLists(id);
  return c.json({ ok: true });
});

configApi.delete('/models/:id', (c) => {
  saveConnections(savedConnections().filter((x) => x.id !== c.req.param('id')));
  forgetLocalLists(c.req.param('id'));
  return c.json({ ok: true });
});

/** Open the plan's own sign-in (Claude Code, Codex, ...) in a terminal window on this computer. */
configApi.post('/models/:id/login', async (c) => {
  const preset = PRESETS.find((p) => p.id === c.req.param('id'));
  if (!preset?.login) return c.json({ error: 'No sign-in for this one.' }, 400);
  if (preset.bin && !binFound(preset.bin)) return c.json({ error: `"${preset.bin}" is not installed. ${preset.hint ?? ''}` }, 409);
  const opened = await openTerminal(preset.login);
  return c.json({ ok: true, opened, command: preset.login });
});

/** A real round trip: one short question to the saved connection. The error text is the provider's own. */
configApi.post('/models/test', async (c) => {
  const { id } = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  let conn = savedConnections().find((x) => x.id === id);
  const preset = PRESETS.find((p) => p.id === id);
  if (!conn && preset?.type === 'cli' && preset.bin && binFound(preset.bin)) conn = { id: preset.id, type: 'cli', command: preset.command, trust: true };
  if (!conn) return c.json({ error: 'Save it first.' }, 404);
  try {
    if (conn.type !== 'cli' && !conn.model) {
      const live = await listModels(conn);
      conn = { ...conn, model: live.free[0] ?? live.models[0] };
      if (!conn.model) return c.json({ error: 'Pick a model first (press Refresh to list them).' }, 400);
    }
    const r = await callModel(conn, 'Reply in at most five words.', [{ role: 'user', content: 'Say hello.' }], [], { signal: AbortSignal.timeout(90_000) });
    return c.json({ ok: true, reply: r.text.trim().slice(0, 200), model: conn.model });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 500) }, 502);
  }
});

/** The provider's live model list for a saved connection, free models first. */
configApi.get('/models/:id/list', async (c) => {
  const conn = savedConnections().find((x) => x.id === c.req.param('id'));
  if (!conn) return c.json({ error: 'Save it first.' }, 404);
  try { return c.json(await listModels(conn)); } catch (e: any) { return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502); }
});
