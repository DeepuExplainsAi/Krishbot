import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { db } from './db.js';
import { env } from './env.js';
import { libraryRoot } from './paths.js';
const botRow = (botId) => db.prepare('SELECT * FROM bots WHERE id=?').get(botId);
// ---------- small file helpers ----------
/** KEY=value lines of a dotenv file (quotes stripped). Missing file = {}. */
function readDotenv(file) {
    const out = {};
    let text = '';
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return out;
    }
    for (const line of text.split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m)
            continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}
function readYaml(file) {
    try {
        return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
    }
    catch {
        return {};
    }
}
function writePrivate(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
}
// ---------- identity ----------
/** Token a bot's Hermes agent presents to this server's MCP endpoint. `primary` names the primary bot. */
export function mcpToken(botId) {
    return crypto.createHmac('sha256', env.sessionSecret).update(`mcp:${botId}`).digest('hex');
}
export function primaryBotId() {
    return db.prepare("SELECT id FROM bots WHERE engine='primary' LIMIT 1").get()?.id ?? null;
}
export function engineKind(botId) {
    const e = botRow(botId)?.engine;
    return e === 'primary' || e === 'managed' ? e : null;
}
const homeFor = (botId) => path.join(env.enginesDir, botId);
let cachedPrimaryKey = null;
function primaryKey() {
    if (env.hermesKey)
        return env.hermesKey;
    if (cachedPrimaryKey === null)
        cachedPrimaryKey = readDotenv(path.join(env.hermesHome, '.env')).API_SERVER_KEY ?? '';
    return cachedPrimaryKey;
}
// ---------- assignment ----------
function freePort() {
    const used = new Set(db.prepare('SELECT engine_port FROM bots WHERE engine_port IS NOT NULL').all().map((r) => r.engine_port));
    let p = env.enginePortBase;
    while (used.has(p))
        p++;
    return p;
}
/** Give a new agent bot its engine: the existing agent if nobody has it yet, otherwise one of our own. */
export function assignEngine(botId) {
    const b = botRow(botId);
    if (!b)
        throw new Error('bot not found');
    if (b.engine === 'primary' || b.engine === 'managed')
        return b.engine;
    if (!primaryBotId()) {
        db.prepare("UPDATE bots SET engine='primary', engine_port=NULL WHERE id=?").run(botId);
        return 'primary';
    }
    db.prepare("UPDATE bots SET engine='managed', engine_port=? WHERE id=?").run(freePort(), botId);
    return 'managed';
}
// ---------- a managed bot's Hermes home ----------
/** Model credentials a managed agent may inherit from the primary agent. Never messaging tokens. */
const SHARED_ENV = [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENROUTER_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NOUS_API_KEY',
    'FIRECRAWL_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'PARALLEL_API_KEY',
];
/** Parts of the primary agent's config a managed agent starts from, so it reaches the same models. */
const SHARED_CONFIG = ['model', 'providers', 'custom_providers', 'auxiliary', 'fallback_model', 'fallback_providers'];
function soul(b) {
    const owner = db.prepare('SELECT name FROM users WHERE id=?').get(b.user_id)?.name ?? 'the user';
    const role = b.label ? `, ${b.label}` : '';
    return [
        `You are ${b.name}${role}. You work for ${owner} as one of a small team of AI agents, all working on the owner's own computer.`,
        b.description ? `\n${b.description}` : '',
        '\nYou are direct, warm and brief. You do the work rather than describe it, and you say plainly what you did and what you could not do.',
        '',
    ].join('\n');
}
/** Rewrite the persona file after a rename or a new description. The primary agent keeps its own. */
export function syncPersona(botId) {
    const b = botRow(botId);
    if (!b || b.engine !== 'managed')
        return;
    const home = homeFor(botId);
    if (!fs.existsSync(home))
        return;
    fs.writeFileSync(path.join(home, 'SOUL.md'), soul(b));
}
function extraMcpServers() {
    if (!env.extraMcpServers)
        return {};
    try {
        const v = JSON.parse(env.extraMcpServers);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    catch {
        console.warn('[engine] EXTRA_MCP_SERVERS is not valid JSON; ignored');
        return {};
    }
}
/** Create or refresh the home. config.yaml is created once; after that only the keys we own are patched. */
async function writeHome(botId) {
    const b = botRow(botId);
    const home = homeFor(botId);
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(home, 'locks'), { recursive: true });
    fs.chmodSync(home, 0o700);
    const cwd = `${libraryRoot()}/${botId}`;
    fs.mkdirSync(cwd, { recursive: true });
    const cfgFile = path.join(home, 'config.yaml');
    const fresh = !fs.existsSync(cfgFile);
    const cfg = fresh ? {} : readYaml(cfgFile);
    if (fresh) {
        const primary = readYaml(path.join(env.hermesHome, 'config.yaml'));
        for (const k of SHARED_CONFIG)
            if (primary[k] !== undefined)
                cfg[k] = primary[k];
        cfg.agent = { reasoning_effort: 'medium' };
    }
    cfg.platform_toolsets = { ...(cfg.platform_toolsets ?? {}), api_server: ['hermes-api-server'] };
    cfg.terminal = { ...(cfg.terminal ?? {}), cwd };
    cfg.mcp_servers = {
        ...(cfg.mcp_servers ?? {}),
        ...extraMcpServers(),
        hq: { url: `${env.mcpBaseUrl}/mcp/${botId}`, headers: { Authorization: `Bearer ${mcpToken(botId)}` }, timeout: 1800, connect_timeout: 30 },
    };
    writePrivate(cfgFile, YAML.stringify(cfg));
    if (!fs.existsSync(path.join(home, 'SOUL.md')))
        fs.writeFileSync(path.join(home, 'SOUL.md'), soul(b));
    // Subscription sign-ins live in auth.json. Start from the primary agent's; later sign-ins are this bot's own.
    const auth = path.join(home, 'auth.json');
    if (!fs.existsSync(auth)) {
        try {
            writePrivate(auth, fs.readFileSync(path.join(env.hermesHome, 'auth.json'), 'utf8'));
        }
        catch { /* the primary agent has none */ }
    }
    // .env is ours entirely: the API server plus inherited model keys. Keys the user added by hand are kept.
    const envFile = path.join(home, '.env');
    const mine = readDotenv(envFile);
    const key = mine.API_SERVER_KEY || crypto.randomBytes(24).toString('hex');
    const primaryEnv = readDotenv(path.join(env.hermesHome, '.env'));
    const vars = { ...mine };
    for (const k of SHARED_ENV) {
        const v = primaryEnv[k] ?? process.env[k];
        if (v && !vars[k])
            vars[k] = v;
    }
    Object.assign(vars, { API_SERVER_ENABLED: 'true', API_SERVER_KEY: key, API_SERVER_PORT: String(b.engine_port), API_SERVER_HOST: '127.0.0.1' });
    writePrivate(envFile, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    return { home, key };
}
// ---------- a managed bot's gateway ----------
async function healthy(url, timeoutMs = 2500) {
    try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        return r.ok ? await r.json() : null;
    }
    catch {
        return null;
    }
}
async function keyAccepted(url, key) {
    try {
        const r = await fetch(`${url}/v1/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(4000) });
        return r.ok;
    }
    catch {
        return false;
    }
}
/** The gateway's pid, but only if the pid file belongs to this home and the process is alive. */
function gatewayPid(home) {
    let raw = '';
    try {
        raw = fs.readFileSync(path.join(home, 'gateway.pid'), 'utf8').trim();
    }
    catch {
        return null;
    }
    let pid = NaN;
    try {
        const j = JSON.parse(raw);
        if (typeof j === 'number')
            pid = j;
        else {
            if (j?.hermes_home && path.resolve(j.hermes_home) !== path.resolve(home))
                return null;
            pid = Number(j?.pid);
        }
    }
    catch {
        pid = Number(raw);
    }
    if (!Number.isInteger(pid) || pid <= 1)
        return null;
    try {
        process.kill(pid, 0);
    }
    catch {
        return null;
    }
    try {
        if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('gateway'))
            return null;
    }
    catch { /* no /proc: trust the pid file */ }
    return pid;
}
async function stopGateway(botId) {
    const home = homeFor(botId);
    const pid = gatewayPid(home);
    if (!pid)
        return;
    const signal = (sig) => {
        try {
            process.kill(-pid, sig);
        }
        catch {
            try {
                process.kill(pid, sig);
            }
            catch { /* gone */ }
        }
    };
    signal('SIGTERM');
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        try {
            process.kill(pid, 0);
        }
        catch {
            return;
        }
    }
    signal('SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
}
const starting = new Map();
const failures = new Map();
const keys = new Map();
function managedUrl(botId) {
    return `http://127.0.0.1:${botRow(botId).engine_port}`;
}
function managedKey(botId) {
    let k = keys.get(botId);
    if (!k) {
        k = readDotenv(path.join(homeFor(botId), '.env')).API_SERVER_KEY ?? '';
        if (k)
            keys.set(botId, k);
    }
    return k;
}
async function startGateway(botId) {
    const b = botRow(botId);
    if (!b || b.engine !== 'managed')
        throw new Error('not a managed engine');
    if (!b.engine_port)
        db.prepare('UPDATE bots SET engine_port=? WHERE id=?').run(freePort(), botId);
    const url = managedUrl(botId);
    // A gateway from an earlier run of this server is still good: use it as it is.
    if ((await healthy(url)) && managedKey(botId) && (await keyAccepted(url, managedKey(botId))))
        return;
    if (await healthy(url)) {
        if (gatewayPid(homeFor(botId)))
            await stopGateway(botId);
        else
            throw new Error(`Port ${botRow(botId).engine_port} is taken by something else.`);
    }
    const { home, key } = await writeHome(botId);
    keys.set(botId, key);
    if (gatewayPid(home))
        await stopGateway(botId);
    const log = fs.openSync(path.join(home, 'logs', 'gateway.out.log'), 'a');
    const child = spawn(env.hermesBin, ['gateway', 'run', '--no-supervise'], {
        cwd: home,
        detached: true,
        stdio: ['ignore', log, log],
        // Only what the agent needs. None of this server's secrets, and nothing of the primary agent's messaging.
        env: {
            PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            HOME: os.homedir(),
            USER: process.env.USER ?? 'root',
            LANG: process.env.LANG ?? 'C.UTF-8',
            HERMES_HOME: home,
            HERMES_GATEWAY_LOCK_DIR: path.join(home, 'locks'),
            // Hermes' browser tool talks to a helper process it finds under this folder. With the default
            // (one folder per HOME) every agent on the computer would end up driving the same browser.
            BH_HOME: path.join(home, 'browser-harness'),
        },
    });
    fs.closeSync(log);
    let exited = null;
    child.once('error', (e) => { exited = `could not run ${env.hermesBin}: ${e.message}`; });
    child.once('exit', (code) => { exited = `the agent stopped while starting (exit ${code}). See ${path.join(home, 'logs', 'gateway.out.log')}`; });
    child.unref();
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (exited)
            throw new Error(exited);
        if (await healthy(url, 1500)) {
            console.log(`[engine] ${b.name}: gateway up on ${url}`);
            return;
        }
    }
    throw new Error('The agent did not come up within 90 seconds.');
}
/** Start (or adopt) the bot's gateway. Safe to call often; concurrent calls share one start. */
function ensureManaged(botId) {
    let p = starting.get(botId);
    if (!p) {
        p = startGateway(botId)
            .then(() => { failures.delete(botId); })
            .catch((e) => {
            const msg = String(e?.message ?? e);
            failures.set(botId, msg);
            console.warn(`[engine] ${botId}: ${msg}`);
            throw e;
        })
            .finally(() => starting.delete(botId));
        starting.set(botId, p);
    }
    return p;
}
/** Where to send this bot's turns. Starts its gateway if it is not running. */
export async function engineFor(botId) {
    let kind = engineKind(botId);
    if (!kind) {
        const b = botRow(botId);
        if (!b)
            throw new Error('bot not found');
        if (b.kind === 'room')
            throw new Error('A group chat has no agent of its own.');
        kind = assignEngine(botId);
    }
    if (kind === 'primary')
        return { kind, url: env.hermesUrl, key: primaryKey(), home: env.hermesHome };
    const url = managedUrl(botId);
    if (!(await healthy(url, 1500)) || !managedKey(botId))
        await ensureManaged(botId);
    return { kind, url, key: managedKey(botId), home: homeFor(botId) };
}
/** The bot's Hermes home, without starting anything (memory files, sign-in commands). */
export function engineHome(botId) {
    const kind = engineKind(botId);
    return kind === 'primary' ? env.hermesHome : kind === 'managed' ? homeFor(botId) : null;
}
/** Start the gateway in the background (after creating a bot, or on server start). */
export function provisionEngine(botId) {
    if (engineKind(botId) === 'managed')
        ensureManaged(botId).catch(() => { });
}
export async function restartEngine(botId) {
    if (engineKind(botId) !== 'managed')
        return;
    await starting.get(botId)?.catch(() => { });
    await stopGateway(botId);
    optionsCache.delete(botId);
    provisionEngine(botId);
}
/** The bot is gone: stop its gateway and delete its home. The primary agent is left alone. */
export async function removeEngine(botId) {
    const home = homeFor(botId);
    if (!fs.existsSync(home))
        return;
    await starting.get(botId)?.catch(() => { });
    await stopGateway(botId);
    keys.delete(botId);
    failures.delete(botId);
    optionsCache.delete(botId);
    if (path.resolve(home).startsWith(path.resolve(env.enginesDir) + path.sep))
        fs.rmSync(home, { recursive: true, force: true });
}
/** On server start: give older bots an engine, then bring the managed gateways up. */
export function initEngines() {
    fs.mkdirSync(env.enginesDir, { recursive: true });
    const bots = db.prepare("SELECT id, is_primary FROM bots WHERE engine IS NULL AND COALESCE(kind,'agent') <> 'room' AND COALESCE(hidden,0)=0 ORDER BY is_primary DESC, created_at ASC").all();
    for (const b of bots)
        assignEngine(b.id);
    for (const b of db.prepare("SELECT id FROM bots WHERE engine='managed'").all())
        provisionEngine(b.id);
}
// ---------- what the settings panel shows ----------
/** Providers worth showing even when not signed in. */
const WELL_KNOWN = ['anthropic', 'openai-codex', 'xai-oauth', 'xai', 'openrouter', 'nous', 'gemini', 'openai-api'];
const optionsCache = new Map();
async function modelOptions(botId, e) {
    const hit = optionsCache.get(botId);
    if (hit && Date.now() - hit.at < 15_000)
        return hit.data;
    try {
        const r = await fetch(`${e.url}/api/model/options`, { headers: e.key ? { Authorization: `Bearer ${e.key}` } : {}, signal: AbortSignal.timeout(8000) });
        if (!r.ok)
            return null;
        const data = await r.json();
        optionsCache.set(botId, { at: Date.now(), data });
        return data;
    }
    catch {
        return null;
    }
}
function toProviders(data) {
    const list = Array.isArray(data?.providers) ? data.providers : [];
    const out = list
        .filter((p) => p?.slug && (p.authenticated || WELL_KNOWN.includes(p.slug)))
        .map((p) => {
        const featured = Array.isArray(p.featured_models) && p.featured_models.length ? p.featured_models : Array.isArray(p.models) ? p.models : [];
        return {
            id: String(p.slug),
            name: String(p.name ?? p.slug),
            // Hermes lists Anthropic as an API-key provider, yet it can also sign in to a Claude subscription. Offer that until a key is in place.
            kind: String(p.auth_type ?? '').includes('oauth') || (p.slug === 'anthropic' && !p.authenticated) ? 'subscription' : 'api_key',
            connected: !!p.authenticated,
            models: featured.filter((m) => typeof m === 'string').slice(0, 12),
        };
    });
    const rank = (p) => (p.connected ? 0 : 1) * 100 + (WELL_KNOWN.indexOf(p.id) < 0 ? 50 : WELL_KNOWN.indexOf(p.id));
    return out.sort((a, b) => rank(a) - rank(b));
}
export async function engineInfo(botId) {
    const b = botRow(botId);
    if (!b)
        throw new Error('bot not found');
    const kind = engineKind(botId);
    const base = { botId, profile: kind === 'primary' ? 'default' : botId, status: 'stopped', error: null, model: b.model ?? null, provider: b.provider ?? null, version: null, providers: [] };
    if (!kind)
        return { ...base, status: 'error', error: 'This bot has no agent.' };
    let e;
    if (kind === 'primary')
        e = { url: env.hermesUrl, key: primaryKey() };
    else {
        if (!b.engine_port)
            return { ...base, status: 'error', error: 'No port assigned.' };
        e = { url: managedUrl(botId), key: managedKey(botId) };
    }
    const health = await healthy(e.url);
    if (!health) {
        if (kind === 'primary')
            return { ...base, status: 'error', error: `The agent at ${env.hermesUrl} is not answering.` };
        if (starting.has(botId))
            return { ...base, status: 'starting' };
        const failed = failures.get(botId);
        if (failed)
            return { ...base, status: 'error', error: failed };
        provisionEngine(botId);
        return { ...base, status: 'starting' };
    }
    if (kind === 'managed' && starting.has(botId))
        return { ...base, status: 'starting' };
    const data = await modelOptions(botId, e);
    return {
        ...base,
        status: 'ready',
        version: typeof health.version === 'string' && health.version !== 'unknown' ? health.version : null,
        model: b.model ?? data?.model ?? null,
        provider: b.provider ?? data?.provider ?? null,
        providers: toProviders(data),
    };
}
/** After a sign-in the provider list changes; drop what we remembered. */
export function forgetEngineOptions(botId) { optionsCache.delete(botId); }
//# sourceMappingURL=engine.js.map