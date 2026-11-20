import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { db, now } from './db.js';
/**
 * Connected apps run on this computer: ready-made MCP servers (started with npx, so Node.js must be
 * installed), MCP servers the user adds, and plain web APIs. Keys are typed in once and kept in the
 * local database. Nothing goes through a hosted service.
 */
db.exec(`CREATE TABLE IF NOT EXISTS apps (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'catalog' | 'mcp' | 'http'
  config TEXT NOT NULL,          -- JSON: catalog values, or the custom app's definition
  created_at INTEGER NOT NULL
)`);
const secret = (key, label) => ({ key, label, secret: true, kind: 'env' });
const npx = (pkg, ...rest) => ({ command: 'npx', args: ['-y', pkg, ...rest] });
export const CATALOG = [
    { slug: 'browser', name: 'Browser', description: 'Open pages, click, type and read websites in a real browser.', categories: ['productivity', 'developer tools'], ...npx('@playwright/mcp@latest'), fields: [] },
    { slug: 'filesystem', name: 'Files', description: 'Read and edit files in a folder you choose.', categories: ['productivity', 'developer tools'], ...npx('@modelcontextprotocol/server-filesystem', '{folder}'), fields: [{ key: 'folder', label: 'Folder path', secret: false, kind: 'arg' }] },
    { slug: 'github', name: 'GitHub', description: 'Repos, issues and pull requests.', categories: ['developer tools'], ...npx('@modelcontextprotocol/server-github'), fields: [secret('GITHUB_PERSONAL_ACCESS_TOKEN', 'Personal access token')] },
    { slug: 'slack', name: 'Slack', description: 'Read and post messages in your Slack workspace.', categories: ['communication'], ...npx('@modelcontextprotocol/server-slack'), fields: [secret('SLACK_BOT_TOKEN', 'Bot token (xoxb-…)'), { key: 'SLACK_TEAM_ID', label: 'Team ID', secret: false, kind: 'env' }] },
    { slug: 'notion', name: 'Notion', description: 'Search and edit pages and databases.', categories: ['productivity'], ...npx('@notionhq/notion-mcp-server'), fields: [secret('NOTION_TOKEN', 'Integration token')] },
    { slug: 'docs', name: 'Code docs', description: 'Up-to-date documentation for libraries and frameworks.', categories: ['developer tools'], ...npx('@upstash/context7-mcp'), fields: [] },
    { slug: 'brave', name: 'Brave Search', description: 'Web search with a free API key.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-brave-search'), fields: [secret('BRAVE_API_KEY', 'API key')] },
    { slug: 'maps', name: 'Google Maps', description: 'Places, directions and distances.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-google-maps'), fields: [secret('GOOGLE_MAPS_API_KEY', 'API key')] },
    { slug: 'figma', name: 'Figma', description: 'Read designs from Figma files.', categories: ['images & design'], ...npx('figma-developer-mcp', '--stdio'), fields: [secret('FIGMA_API_KEY', 'Personal access token')] },
];
const rows = () => db.prepare('SELECT * FROM apps ORDER BY created_at').all().map((r) => ({ ...r, config: JSON.parse(r.config) }));
// ---------- listing ----------
export function listApps() {
    const mine = new Map(rows().map((r) => [r.slug, r]));
    const catalog = CATALOG.map((c) => ({
        slug: c.slug, name: c.name, description: c.description, categories: c.categories,
        managedAuth: false, noAuth: false, connected: mine.has(c.slug),
        needs: c.fields.map(({ key, label, secret }) => ({ key, label, secret })),
    }));
    const custom = rows().filter((r) => r.kind !== 'catalog').map((r) => ({
        slug: r.slug, name: r.name, categories: ['custom'], managedAuth: false, noAuth: false, connected: true, custom: true, needs: [],
        description: r.config.description || (r.kind === 'http' ? `${r.config.method} ${r.config.url}` : 'Custom MCP server'),
    }));
    return [...catalog, ...custom];
}
export const connectedSlugs = () => new Set(rows().map((r) => r.slug));
export const appInfo = (slug) => listApps().find((a) => a.slug === slug);
const live = new Map();
function specOf(r) {
    if (r.kind === 'mcp')
        return r.config.url ? { url: r.config.url, headers: r.config.headers } : { command: r.config.command, args: r.config.args ?? [], env: r.config.env ?? {} };
    const cat = CATALOG.find((c) => c.slug === r.slug);
    if (!cat)
        return null;
    const values = r.config.values ?? {};
    const sub = (s) => s.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
    const env = {};
    for (const f of cat.fields)
        if (f.kind === 'env' && values[f.key])
            env[f.key] = values[f.key];
    return { command: cat.command, args: cat.args.map(sub), env };
}
async function connect(slug, spec) {
    const have = live.get(slug);
    if (have)
        return have;
    const client = new Client({ name: 'krishbot', version: '1.0.0' });
    const transport = spec.url
        ? new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers ?? {} } })
        : new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: { ...process.env, ...(spec.env ?? {}) }, stderr: 'ignore' });
    await client.connect(transport);
    const entry = { client, tools: (await client.listTools()).tools };
    live.set(slug, entry);
    return entry;
}
async function close(slug) {
    const c = live.get(slug);
    live.delete(slug);
    try {
        await c?.client.close();
    }
    catch { /* already gone */ }
}
/** Save a catalog app with the user's values and check that it starts. */
export async function connectCatalogApp(slug, values) {
    const cat = CATALOG.find((c) => c.slug === slug);
    if (!cat)
        throw new Error('Unknown app');
    const missing = cat.fields.filter((f) => !String(values[f.key] ?? '').trim());
    if (missing.length)
        throw new Error(`Fill in: ${missing.map((f) => f.label).join(', ')}`);
    await close(slug);
    const row = { slug, name: cat.name, kind: 'catalog', config: { values } };
    try {
        await connect(slug, specOf(row));
    }
    catch (e) {
        await close(slug);
        throw new Error(`Couldn’t start ${cat.name}: ${e.message}. Is Node.js installed?`);
    }
    db.prepare('INSERT OR REPLACE INTO apps(slug,name,kind,config,created_at) VALUES (?,?,?,?,?)').run(slug, cat.name, 'catalog', JSON.stringify({ values }), now());
}
export async function addCustomApp(a) {
    const name = String(a.name ?? '').trim();
    if (!name || !(a.url || a.command))
        throw new Error('Name and a URL or command are required');
    const slug = `c_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'app'}`;
    const kind = a.kind === 'http' ? 'http' : 'mcp';
    const config = kind === 'http'
        ? { description: a.description, url: a.url, method: a.method || 'GET', headers: a.headers ?? '', body: a.body ?? '' }
        : { description: a.description, url: a.url, headers: a.headers, command: a.command, args: a.args ?? [], env: a.env };
    const row = { slug, name, kind, config };
    if (kind === 'mcp') {
        await close(slug);
        try {
            await connect(slug, specOf(row));
        }
        catch (e) {
            await close(slug);
            throw new Error(`Couldn’t start it: ${e.message}`);
        }
    }
    db.prepare('INSERT OR REPLACE INTO apps(slug,name,kind,config,created_at) VALUES (?,?,?,?,?)').run(slug, name, kind, JSON.stringify(config), now());
}
export async function removeApp(slug) {
    db.prepare('DELETE FROM apps WHERE slug=?').run(slug);
    await close(slug);
}
const clip = (s, n = 60_000) => (s.length > n ? `${s.slice(0, n)}…(truncated)` : s);
const toolName = (slug, tool) => `${slug.replace(/\W/g, '_')}__${tool}`.slice(0, 64);
function httpTool(r) {
    const c = r.config;
    const fillText = [c.url, c.body, c.headers].join('\n');
    const params = [...new Set([...fillText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const fill = (s, a, enc = false) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (a[k] == null ? '' : enc ? encodeURIComponent(a[k]) : String(a[k])));
    const method = c.method || 'GET';
    return {
        name: toolName(r.slug, 'call'), slug: r.slug, appName: r.name, readOnly: method === 'GET',
        description: c.description || `Call the ${r.name} API (${method}).`,
        inputSchema: { type: 'object', properties: Object.fromEntries(params.map((p) => [p, { type: 'string' }])), required: params },
        run: async (a, signal) => {
            const headers = {};
            for (const line of String(c.headers || '').split('\n')) {
                const i = line.indexOf(':');
                if (i > 0)
                    headers[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), a);
            }
            const body = method === 'GET' || !c.body ? undefined : fill(c.body, a);
            if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type'))
                headers['content-type'] = 'application/json';
            const res = await fetch(fill(c.url, a, true), { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)].filter((s) => !!s)) });
            return clip(`HTTP ${res.status}\n${await res.text()}`);
        },
    };
}
let cache = null;
export const forgetAppTools = () => { cache = null; };
/** Every tool of every connected app. Apps that fail to start are skipped (and logged once per refresh). */
export async function appTools() {
    if (cache && Date.now() - cache.at < 30_000)
        return cache.tools;
    const out = [];
    for (const r of rows()) {
        if (r.kind === 'http') {
            out.push(httpTool(r));
            continue;
        }
        const spec = specOf(r);
        if (!spec)
            continue;
        try {
            const { client, tools } = await connect(r.slug, spec);
            for (const t of tools)
                out.push({
                    name: toolName(r.slug, t.name), slug: r.slug, appName: r.name, description: t.description || t.name, inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
                    readOnly: !!t.annotations?.readOnlyHint,
                    run: async (args) => {
                        const res = await client.callTool({ name: t.name, arguments: args });
                        return clip((res.content ?? []).map((c) => c.text ?? `[${c.type}]`).join('\n') || '(empty)');
                    },
                });
        }
        catch (e) {
            console.warn(`[apps] ${r.name} is not reachable: ${e?.message ?? e}`);
            await close(r.slug);
        }
    }
    cache = { at: Date.now(), tools: out };
    return out;
}
export const findAppTool = async (name) => (await appTools()).find((t) => t.name.toLowerCase() === name.toLowerCase());
/** The app a call to `name` belongs to, for approval cards (no start-up of servers). */
export const humanizeTool = (name) => {
    const [slug, ...rest] = name.split('__');
    const app = appInfo(slug)?.name ?? slug;
    return `${app}: ${rest.join('__').replace(/[_-]+/g, ' ').toLowerCase()}`;
};
/** A tool from the last listing, without starting anything. */
export const cachedAppTool = (name) => cache?.tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
//# sourceMappingURL=apps.js.map