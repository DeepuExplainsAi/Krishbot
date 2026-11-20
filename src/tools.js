import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CATALOG, specFor } from './catalog.js';
import { state, libraryDir } from './store.js';

export const obj = (properties, required = []) => ({ type: 'object', properties, required });
export const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const clip = (s, n = 20000) => (s.length > n ? s.slice(0, n) + `\n…[cut ${s.length - n} characters]` : s);
const home = (p) => p.replace(/^~(?=$|\/|\\)/, os.homedir());
const inLibrary = (botId, p) => path.resolve(libraryDir(botId), home(String(p)));
const short = (s, n = 90) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

// ---------- built-in tools ----------
// label: shown in the chat. risky: asks first (unless always allowed). activity: the status word while it runs.
export function builtinTools(bot) {
  const lib = () => libraryDir(bot.id);
  return [
    {
      name: 'run_command', risky: true, activity: 'running_commands', label: (a) => `Running ${short(a.command, 60)}`,
      description: `Run a shell command on the user's computer and get its output. Default folder is the bot's Library folder (${lib()}).`,
      parameters: obj({ command: str('The command'), cwd: str('Folder to run in (optional)') }, ['command']),
      run: async ({ command, cwd }, { signal }) => {
        await fs.mkdir(lib(), { recursive: true });
        return new Promise((ok) => exec(command, { cwd: cwd ? home(cwd) : lib(), timeout: 180_000, maxBuffer: 8e6, signal }, (e, so, se) => ok(clip(`${so}${se}${e ? `\n[exit ${e.code ?? e.signal}]` : ''}`).trim() || '(no output)')));
      },
    },
    { name: 'read_file', activity: 'working', label: (a) => `Reading ${short(a.path, 50)}`, description: 'Read a text file.', parameters: obj({ path: str('File path') }, ['path']), run: async ({ path: p }) => clip(await fs.readFile(inLibrary(bot.id, p), 'utf8')) },
    { name: 'list_dir', activity: 'working', label: (a) => `Looking in ${short(a.path || '.', 50)}`, description: 'List a folder.', parameters: obj({ path: str('Folder path (default: Library)') }), run: async ({ path: p }) => (await fs.readdir(inLibrary(bot.id, p || '.'), { withFileTypes: true })).map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n') || '(empty)' },
    {
      name: 'write_file', risky: true, activity: 'drafting_file', label: (a) => `Writing ${short(a.path, 50)}`,
      description: `Create or overwrite a text file. Relative paths go in the Library folder (${lib()}), where the user can find them.`,
      parameters: obj({ path: str('File path'), content: str('Full file content') }, ['path', 'content']),
      run: async ({ path: p, content }) => { const f = inLibrary(bot.id, p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, content); return `Wrote ${content.length} characters to ${f}`; },
    },
    {
      name: 'fetch_url', activity: 'reading_web', label: (a) => `Reading ${short(a.url, 60)}`, description: 'Download a web page or API response as text.', parameters: obj({ url: str('http(s) URL') }, ['url']),
      run: async ({ url }, { signal }) => {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)].filter(Boolean)) });
        const t = await r.text();
        return clip(/html/.test(r.headers.get('content-type') || '') ? t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : t);
      },
    },
    {
      name: 'web_search', activity: 'searching_web', label: (a) => `Searching “${short(a.query, 50)}”`, description: 'Search the web.', parameters: obj({ query: str('Search query') }, ['query']),
      run: async ({ query }, { signal }) => {
        const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)].filter(Boolean)) });
        const html = await r.text(), t = (s) => s.replace(/<[^>]+>/g, '').trim();
        const out = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8)
          .map((m) => `${t(m[2])}\n${decodeURIComponent((m[1].match(/uddg=([^&]+)/) || [, m[1]])[1])}\n${t(m[3])}`);
        return out.join('\n\n') || 'No results.';
      },
    },
  ];
}

// ---------- custom HTTP API ----------
function httpTool(app) {
  const params = [...new Set([...(app.url + app.body + app.headers).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const fill = (s, a, enc) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (a[k] == null ? '' : enc ? encodeURIComponent(a[k]) : String(a[k])));
  const method = app.method || 'GET';
  return {
    name: app.slug.replace(/\W/g, '_'), toolkit: app.slug, risky: method !== 'GET', activity: 'connecting_service', label: () => `Calling ${app.name}`,
    description: app.description || `Call the ${app.name} API.`,
    parameters: obj(Object.fromEntries(params.map((p) => [p, str(p)])), params),
    run: async (a, { signal }) => {
      const headers = {};
      for (const line of String(app.headers || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), a); }
      const body = method === 'GET' || !app.body ? undefined : fill(app.body, a);
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      const r = await fetch(fill(app.url, a, true), { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)].filter(Boolean)) });
      return clip(`HTTP ${r.status}\n${await r.text()}`);
    },
  };
}

// ---------- MCP servers ----------
const clients = new Map(); // slug -> { client, tools }

export function mcpSpec(app, values) {
  if (app.kind === 'mcp') return app.url ? { url: app.url, headers: app.headers } : { command: app.command, args: app.args || [], env: app.env || {} };
  const cat = CATALOG.find((c) => c.slug === app.slug);
  return cat ? specFor(cat, values) : null;
}

export async function connectMcp(slug, spec) {
  if (clients.has(slug)) return clients.get(slug);
  const client = new Client({ name: 'krishbot', version: '1.0.0' });
  const transport = spec.url
    ? new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers || {} } })
    : new StdioClientTransport({ command: spec.command, args: spec.args || [], env: { ...process.env, ...(spec.env || {}) }, stderr: 'ignore' });
  const entry = { client, tools: [] };
  await client.connect(transport);
  entry.tools = (await client.listTools()).tools;
  clients.set(slug, entry);
  return entry;
}
export async function closeMcp(slug) { const c = clients.get(slug); clients.delete(slug); try { await c?.client.close(); } catch { /* already gone */ } }

const slugName = (s) => s.replace(/[^\w]/g, '_').slice(0, 24);

// Everything the user connected, as tools. Returns { tools, errors, servers } (servers: for command-line agents).
export async function appTools() {
  const tools = [], errors = [], servers = [];
  for (const [slug, a] of Object.entries(state.apps)) {
    const cat = CATALOG.find((c) => c.slug === slug);
    if (!cat) continue;
    await addMcp(slug, cat.name, specFor(cat, a.values), tools, errors, servers);
  }
  for (const app of state.customApps) {
    if (app.kind === 'http') tools.push(httpTool(app));
    else await addMcp(app.slug, app.name, mcpSpec(app), tools, errors, servers);
  }
  return { tools, errors, servers };
}

async function addMcp(slug, name, spec, tools, errors, servers) {
  try {
    const { client, tools: list } = await connectMcp(slug, spec);
    servers.push({ name: slug, ...spec });
    for (const t of list) tools.push({
      name: `${slugName(slug)}__${t.name}`.slice(0, 64), toolkit: slug, appName: name, risky: !t.annotations?.readOnlyHint, activity: 'connecting_service',
      label: () => `${name}: ${t.title || t.name.replace(/[_-]/g, ' ')}`, description: t.description || t.name, parameters: t.inputSchema,
      run: async (a) => { const r = await client.callTool({ name: t.name, arguments: a }); return clip((r.content || []).map((c) => c.text ?? `[${c.type}]`).join('\n') || '(empty)'); },
    });
  } catch (e) { errors.push(`${name} isn’t reachable: ${e.message}`); }
}

export { num };
