import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db.js';
import { autoApprove } from '../settings.js';
import { libraryRoot } from '../paths.js';
import { appTools } from '../apps.js';
import { appendHistory, loadHistory } from '../store.js';
import { callModel, type Conn, type Msg, type ToolSpec } from '../providers.js';
import { policyFor, runAppTool, toolMap, TOOLS, type ToolCtx } from './tools.js';
import type { ActivityKind } from '../types.js';

/**
 * The agent loop for bots that run on a direct model connection (see providers.ts) instead of Hermes:
 * history -> model -> tool calls -> results -> model ... until the model answers without a tool call.
 * Tools: the app's own (tasks, routines, bots, files ...), the user's connected apps, and a few local ones.
 */

const STEP_CAP: Record<string, number> = { low: 6, medium: 14, high: 24, xhigh: 40 };
const clip = (s: string, n = 20_000) => (s.length > n ? `${s.slice(0, n)}\n…[cut ${s.length - n} characters]` : s);
const short = (s: unknown, n = 60) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
const home = (p: string) => p.replace(/^~(?=$|\/|\\)/, os.homedir());
const sig = (signal: AbortSignal | undefined, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)].filter((s): s is AbortSignal => !!s));
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });

interface LocalTool { name: string; description: string; parameters: any; risky?: boolean; kind: ActivityKind; label: (a: any) => string; run: (a: any, signal?: AbortSignal) => Promise<string> }

function localTools(botId: string): LocalTool[] {
  const lib = path.join(libraryRoot(), botId);
  const resolve = (p: string) => path.resolve(lib, home(String(p || '.')));
  return [
    { name: 'run_command', risky: true, kind: 'running_commands', label: (a) => `Running ${short(a.command)}`,
      description: `Run a shell command on the user's computer and get its output. Default folder is your Library folder (${lib}).`,
      parameters: obj({ command: str('The command'), cwd: str('Folder to run in (optional)') }, ['command']),
      run: async ({ command, cwd }, signal) => {
        await fs.mkdir(lib, { recursive: true });
        return new Promise((ok) => exec(String(command), { cwd: cwd ? home(cwd) : lib, timeout: 180_000, maxBuffer: 8e6, signal }, (e: any, so, se) => ok(clip(`${so}${se}${e ? `\n[exit ${e.code ?? e.signal}]` : ''}`).trim() || '(no output)')));
      } },
    { name: 'read_file', kind: 'working', label: (a) => `Reading ${short(a.path, 50)}`, description: 'Read a text file.', parameters: obj({ path: str('File path') }, ['path']), run: async ({ path: p }) => clip(await fs.readFile(resolve(p), 'utf8')) },
    { name: 'list_dir', kind: 'working', label: (a) => `Looking in ${short(a.path || '.', 50)}`, description: 'List a folder (default: your Library).', parameters: obj({ path: str('Folder path') }),
      run: async ({ path: p }) => (await fs.readdir(resolve(p || '.'), { withFileTypes: true })).map((d) => d.name + (d.isDirectory() ? '/' : '')).join('\n') || '(empty)' },
    { name: 'write_file', risky: true, kind: 'drafting_file', label: (a) => `Writing ${short(a.path, 50)}`,
      description: `Create or overwrite a text file. Relative paths go in your Library folder (${lib}).`,
      parameters: obj({ path: str('File path'), content: str('Full file content') }, ['path', 'content']),
      run: async ({ path: p, content }) => { const f = resolve(p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, String(content)); return `Wrote ${String(content).length} characters to ${f}`; } },
    { name: 'fetch_url', kind: 'reading_web', label: (a) => `Reading ${short(a.url)}`, description: 'Download a web page or API response as text.', parameters: obj({ url: str('http(s) URL') }, ['url']),
      run: async ({ url }, signal) => {
        const r = await fetch(String(url), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: sig(signal, 30_000) });
        const t = await r.text();
        return clip(/html/.test(r.headers.get('content-type') || '') ? t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : t);
      } },
    { name: 'web_search', kind: 'searching_web', label: (a) => `Searching “${short(a.query, 50)}”`, description: 'Search the web.', parameters: obj({ query: str('Search query') }, ['query']),
      run: async ({ query }, signal) => {
        const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query))}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: sig(signal, 30_000) });
        const html = await r.text();
        const t = (s: string) => s.replace(/<[^>]+>/g, '').trim();
        const out = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 8)
          .map((m) => `${t(m[2])}\n${decodeURIComponent((m[1].match(/uddg=([^&]+)/) || [, m[1]])[1] as string)}\n${t(m[3])}`);
        return out.join('\n\n') || 'No results.';
      } },
  ];
}

export interface DirectHost {
  botId: string;
  userId: string;
  depth: number;
  signal: AbortSignal;
  effort: string;
  conn: Conn;
  model: string | null;
  system: string;
  input: string;
  /** Text the model wrote (before or after tool calls). */
  say: (text: string) => void;
  /** A tool call starts; returns the row to finish later. */
  toolStart: (name: string, label: string, kind: ActivityKind, args: any) => number;
  toolEnd: (seq: number, status: 'done' | 'error' | 'denied', summary?: string) => void;
  setActivity: (kind: ActivityKind, detail?: string) => void;
  approve: (pol: { key: string; toolkit?: string; title: string }, args: any, seq: number) => Promise<'allow' | 'deny' | 'expired'>;
  ctx: ToolCtx;
  /** A tool ended the conversation for now (asked the user, stayed silent). */
  silent: () => void;
  isSilent: () => boolean;
}

const asksFirst = (userId: string, key: string) => {
  if (autoApprove()) return false;
  const p = db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, key) as any;
  return p?.mode !== 'always_allow';
};

function trimHistory(list: Msg[]): Msg[] {
  if (list.length <= 80) return list;
  let i = list.length - 60;
  while (i < list.length && list[i].role !== 'user') i++;
  return i < list.length ? list.slice(i) : list.slice(-2);
}

export async function runDirect(h: DirectHost) {
  const conn = h.conn.type === 'cli' ? h.conn : { ...h.conn, model: h.model || h.conn.model };
  if (conn.type !== 'cli' && !conn.model) throw new Error(`No model chosen for ${h.conn.id}. Pick one in the Engine section, or press Refresh to list them.`);

  const local = localTools(h.botId);
  const mine = new Map(local.map((t) => [t.name, t]));
  const apps = conn.type === 'cli' ? [] : await appTools();
  const specs: ToolSpec[] = conn.type === 'cli' ? [] : [
    ...local.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ...TOOLS.filter((t) => !mine.has(t.name)).map(({ name, description, parameters }) => ({ name, description, parameters })),
    ...apps.filter((t) => !toolMap.has(t.name) && !mine.has(t.name)).map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema ?? obj({}) })),
  ];

  const history = trimHistory(loadHistory(h.botId) as Msg[]);
  const fresh: Msg[] = [{ role: 'user', content: h.input }];
  const all = () => [...history, ...fresh];
  const cap = STEP_CAP[h.effort] ?? 14;

  try {
    for (let step = 0; ; step++) {
      if (h.signal.aborted) throw new Error('interrupted');
      h.setActivity('thinking');
      const reply = await callModel(conn, h.system, all(), specs, { signal: h.signal, botId: h.botId });
      fresh.push({ role: 'assistant', content: reply.text, ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}) });
      if (reply.text.trim()) h.say(reply.text);
      if (!reply.toolCalls.length) return;
      if (step >= cap) { h.say('I stopped here because I reached my step limit for one message. Tell me to continue if you want more.'); return; }

      for (const call of reply.toolCalls) {
        let out: string;
        const own = toolMap.get(call.name);
        const loc = mine.get(call.name);
        const label = loc ? loc.label(call.args) : own ? own.label : (await import('../apps.js')).humanizeTool(call.name);
        const kind: ActivityKind = loc?.kind ?? own?.activity ?? 'connecting_service';
        const seq = h.toolStart(call.name, label, kind, call.args);
        h.setActivity(kind);
        try {
          if (loc) {
            if (loc.risky && asksFirst(h.userId, loc.name)) {
              const d = await h.approve({ key: loc.name, title: `${h.ctx.botId}: ${label}` }, call.args, seq);
              if (d !== 'allow') { h.toolEnd(seq, 'denied', 'Not allowed'); fresh.push({ role: 'tool', toolCallId: call.id, content: 'The user did not allow this. Do not retry; find another way or say what you could not do.' }); continue; }
            }
            out = await loc.run(call.args, h.signal);
          } else if (own) {
            const r = await own.impl(call.args, h.ctx);
            if (r.endTurn) h.silent();
            out = r.output;
          } else {
            const pol = policyFor(h.userId, call.name, call.args);
            if (pol.decision === 'block') { h.toolEnd(seq, 'denied', 'Not allowed'); fresh.push({ role: 'tool', toolCallId: call.id, content: 'The user blocked this action. Do not retry.' }); continue; }
            if (pol.decision === 'ask') {
              const d = await h.approve(pol, call.args, seq);
              if (d !== 'allow') { h.toolEnd(seq, 'denied', d === 'deny' ? 'Not allowed' : 'Skipped'); fresh.push({ role: 'tool', toolCallId: call.id, content: d === 'deny' ? 'The user declined this action. Do not retry.' : 'Skipped: the user did not answer in time. Do not retry unless asked.' }); continue; }
            }
            const r = await runAppTool(h.ctx, call.name, call.args);
            out = r.output;
          }
          h.toolEnd(seq, /^Tool error/.test(out) ? 'error' : 'done');
        } catch (e: any) {
          if (h.signal.aborted) throw e;
          out = `Tool error: ${e?.message ?? e}`;
          h.toolEnd(seq, 'error', String(e?.message ?? e).slice(0, 200));
        }
        fresh.push({ role: 'tool', toolCallId: call.id, content: clip(out) });
      }
      if (h.isSilent()) return;
    }
  } finally {
    // Keep what happened, also when stopped midway, but never a dangling tool call.
    while (fresh.length && fresh[fresh.length - 1].role === 'assistant' && fresh[fresh.length - 1].toolCalls) fresh.pop();
    appendHistory(h.botId, fresh);
  }
}
