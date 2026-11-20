import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });
const clip = (s, n = 20000) => (s.length > n ? s.slice(0, n) + `\n…[cut ${s.length - n} chars]` : s);
const resolve = (p) => path.resolve(p.replace(/^~(?=$|\/|\\)/, os.homedir()));

// Built-in tools. `risky` ones wait for the user's OK unless auto-approve is on.
export const BUILTIN = {
  shell: [{
    name: 'run_command', description: 'Run a shell command on the user\'s computer and return its output.', risky: true,
    parameters: obj({ command: str('The command'), cwd: str('Working folder (optional)') }, ['command']),
    run: ({ command, cwd }) => new Promise((ok) => exec(command, { cwd: cwd ? resolve(cwd) : os.homedir(), timeout: 120_000, maxBuffer: 5e6 }, (e, so, se) => ok(clip(`${so}${se}${e ? `\n[exit ${e.code ?? e.signal}]` : ''}`) || '(no output)'))),
  }],
  files: [
    { name: 'read_file', description: 'Read a text file.', parameters: obj({ path: str('File path') }, ['path']), run: async ({ path: p }) => clip(await fs.readFile(resolve(p), 'utf8')) },
    { name: 'list_dir', description: 'List a folder.', parameters: obj({ path: str('Folder path') }, ['path']), run: async ({ path: p }) => (await fs.readdir(resolve(p), { withFileTypes: true })).map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n') },
    { name: 'write_file', description: 'Create or overwrite a text file.', risky: true, parameters: obj({ path: str('File path'), content: str('Full file content') }, ['path', 'content']), run: async ({ path: p, content }) => { await fs.mkdir(path.dirname(resolve(p)), { recursive: true }); await fs.writeFile(resolve(p), content); return `Wrote ${content.length} chars to ${p}`; } },
  ],
  web: [
    {
      name: 'fetch_url', description: 'Download a web page or API response as text.', parameters: obj({ url: str('http(s) URL') }, ['url']),
      run: async ({ url }) => { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) }); const t = await r.text(); return clip(/html/.test(r.headers.get('content-type') || '') ? t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : t); },
    },
    {
      name: 'web_search', description: 'Search the web.', parameters: obj({ query: str('Search query') }, ['query']),
      run: async ({ query }) => {
        const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30_000) });
        const html = await r.text();
        const out = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8)
          .map((m) => { const u = decodeURIComponent((m[1].match(/uddg=([^&]+)/) || [, m[1]])[1]); const t = (s) => s.replace(/<[^>]+>/g, '').trim(); return `${t(m[2])}\n${u}\n${t(m[3])}`; });
        return out.join('\n\n') || 'No results.';
      },
    },
  ],
};

// A custom HTTP API the user described in Settings. {placeholders} in url/body/headers are filled from the model's arguments.
function customTool(t) {
  const props = Object.fromEntries((t.params || []).map((p) => [p.name, str(p.description || p.name)]));
  const fill = (s, a) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (a[k] == null ? '' : String(a[k])));
  return {
    name: t.name, description: t.description || t.name, risky: t.method && t.method !== 'GET',
    parameters: obj(props, (t.params || []).filter((p) => p.required).map((p) => p.name)),
    run: async (a) => {
      const headers = {};
      for (const line of String(t.headers || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), a); }
      const method = t.method || 'GET';
      const body = method === 'GET' || !t.body ? undefined : fill(t.body, a);
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      const r = await fetch(fill(t.url, Object.fromEntries(Object.entries(a).map(([k, v]) => [k, encodeURIComponent(v)]))), { method, headers, body, signal: AbortSignal.timeout(60_000) });
      return clip(`HTTP ${r.status}\n${await r.text()}`);
    },
  };
}

// ---- MCP servers (stdio command or http url) ----
const mcp = new Map(); // key -> { client, tools }
const mcpKey = (s) => JSON.stringify([s.command, s.args, s.url, s.env, s.headers]);

async function connectMcp(s) {
  const k = mcpKey(s);
  if (mcp.has(k)) return mcp.get(k);
  const client = new Client({ name: 'krishbot', version: '1.0.0' });
  const transport = s.url
    ? new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers || {} } })
    : new StdioClientTransport({ command: s.command, args: s.args || [], env: { ...process.env, ...(s.env || {}) } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const entry = { client, tools };
  mcp.set(k, entry);
  return entry;
}

const slug = (s) => s.replace(/[^\w]/g, '_').slice(0, 24);

// All tools a bot may use: [{name, description, parameters, risky, run}]. Problems are returned in `errors`.
export async function toolsFor(bot, cfg) {
  const out = [], errors = [];
  for (const group of bot.tools || []) out.push(...(BUILTIN[group] || []));
  for (const t of cfg.customTools || []) if ((bot.customTools || []).includes(t.name)) out.push(customTool(t));
  for (const s of cfg.mcpServers || []) {
    if (!(bot.mcp || []).includes(s.name)) continue;
    try {
      const { client, tools } = await connectMcp(s);
      for (const t of tools) out.push({
        name: `${slug(s.name)}__${t.name}`.slice(0, 64), description: t.description || t.name, parameters: t.inputSchema, risky: !t.annotations?.readOnlyHint,
        run: async (a) => { const r = await client.callTool({ name: t.name, arguments: a }); return clip((r.content || []).map((c) => c.text ?? `[${c.type}]`).join('\n') || '(empty)'); },
      });
    } catch (e) { errors.push(`MCP "${s.name}": ${e.message}`); }
  }
  return { tools: out, errors };
}

export async function testMcp(s) {
  const { tools } = await connectMcp(s);
  return tools.map((t) => t.name);
}
