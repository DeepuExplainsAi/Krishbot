import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from './env.js';
import { mcpToken } from './engine.js';
import { getSetting, setSetting } from './settings.js';

/**
 * Direct model access, no agent harness needed: an OpenAI-compatible API, the Anthropic API, or a
 * command-line assistant the user is already signed in to (Claude Code, Codex, Gemini CLI).
 * Neutral messages: {role:'user'|'assistant'|'tool', content, toolCalls?, toolCallId?}.
 */

export type ConnType = 'openai' | 'anthropic' | 'cli';
export interface Conn { id: string; type: ConnType; baseUrl?: string; apiKey?: string; model?: string; command?: string; trust?: boolean }
export interface ToolSpec { name: string; description: string; parameters: any }
export interface ToolCall { id: string; name: string; args: any }
export interface ModelReply { text: string; toolCalls: ToolCall[] }
export interface Msg { role: 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }

export interface Preset {
  id: string; group: string; label: string; type: ConnType; hint?: string;
  command?: string; bin?: string; baseUrl?: string; model?: string; models?: string[]; needsKey?: boolean;
}

// Model ids checked against the providers' docs in November 2026. The live list (Refresh) is the source of truth.
export const PRESETS: Preset[] = [
  { id: 'claude-cli', group: 'Your subscription', label: 'Claude (Pro/Max plan, via Claude Code)', type: 'cli', command: 'claude -p', bin: 'claude', hint: 'Install Claude Code and run `claude` once to sign in. It uses your own plan.' },
  { id: 'codex-cli', group: 'Your subscription', label: 'ChatGPT (Plus/Pro plan, via Codex)', type: 'cli', command: 'codex exec --skip-git-repo-check -', bin: 'codex', hint: 'Install Codex CLI and run `codex` once to sign in with ChatGPT.' },
  { id: 'gemini-cli', group: 'Your subscription', label: 'Gemini (Google account, via Gemini CLI)', type: 'cli', command: 'gemini -p " "', bin: 'gemini', hint: 'Install Gemini CLI and run `gemini` once to sign in with Google (has a free tier).' },
  { id: 'custom-cli', group: 'Your subscription', label: 'Any command (prompt goes to stdin)', type: 'cli', command: '', hint: 'Any program that reads a prompt on stdin and prints the answer.' },
  { id: 'ollama', group: 'On this computer, free', label: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', models: [], hint: 'Install Ollama, run `ollama pull <model>`, then press Refresh to pick it.' },
  { id: 'lmstudio', group: 'On this computer, free', label: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', models: [], hint: 'Start the LM Studio local server, load a model, then press Refresh.' },
  { id: 'openrouter', group: 'Free tiers', label: 'OpenRouter (many free models)', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', models: [], needsKey: true, hint: 'Free key at openrouter.ai/keys. Refresh lists the free models first.' },
  { id: 'gemini', group: 'Free tiers', label: 'Google Gemini API', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash', models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'], needsKey: true, hint: 'Free key at aistudio.google.com/apikey' },
  { id: 'groq', group: 'Free tiers', label: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', models: [], needsKey: true, hint: 'Free key at console.groq.com/keys. Refresh to list models.' },
  { id: 'openai', group: 'API keys', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', models: ['gpt-6.2-astra', 'gpt-6-luna'], needsKey: true },
  { id: 'anthropic', group: 'API keys', label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', models: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], needsKey: true },
  { id: 'xai', group: 'API keys', label: 'xAI (Grok)', type: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7', models: ['grok-4.7'], needsKey: true },
  { id: 'custom', group: 'API keys', label: 'Any OpenAI-compatible API', type: 'openai', baseUrl: '', model: '', models: [], needsKey: true },
];

const binCache = new Map<string, boolean>();
export function binFound(bin: string): boolean {
  if (!binCache.has(bin)) {
    try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); binCache.set(bin, true); } catch { binCache.set(bin, false); }
  }
  return binCache.get(bin)!;
}
export const forgetBins = () => binCache.clear();

// ---------- saved connections ----------

export function savedConnections(): Conn[] {
  try { const v = JSON.parse(getSetting('connections') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export const saveConnections = (list: Conn[]) => setSetting('connections', JSON.stringify(list));

/** Saved connections, plus every command-line assistant found on this computer (they need no setup). */
export function allConnections(): Conn[] {
  const saved = savedConnections();
  const auto = PRESETS.filter((p) => p.type === 'cli' && p.bin && binFound(p.bin) && !saved.some((c) => c.id === p.id))
    .map((p): Conn => ({ id: p.id, type: 'cli', command: p.command, trust: true }));
  return [...saved.filter(usable), ...auto];
}
export const usable = (c: Conn) => (c.type === 'cli' ? !!c.command : !!c.baseUrl || c.type === 'anthropic');
export const connection = (id: string) => allConnections().find((c) => c.id === id);
export const connLabel = (c: Conn) => PRESETS.find((p) => p.id === c.id)?.label ?? c.id;

// ---------- calling a model ----------

const trim = (u: string) => u.replace(/\/+$/, '');
const safeJson = (s: string) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** Providers reject some JSON-schema keywords; none of our tools need them. */
const cleanSchema = (s: any): any => (Array.isArray(s) ? s.map(cleanSchema) : s && typeof s === 'object'
  ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'additionalProperties').map(([k, v]) => [k, cleanSchema(v)])) : s);

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let r: Response;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal }); }
  catch (e: any) { if (signal?.aborted) throw e; throw new Error(`Could not reach ${new URL(url).host}: ${e?.cause?.code ?? e?.message ?? e}`); }
  const t = await r.text();
  if (!r.ok) {
    let msg = t.slice(0, 400);
    try { const j = JSON.parse(t); msg = j?.error?.message ?? j?.error ?? j?.message ?? msg; } catch { /* plain text */ }
    throw new Error(`The model service answered ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return JSON.parse(t);
}

async function openai(p: Conn, system: string, messages: Msg[], tools: ToolSpec[], signal?: AbortSignal): Promise<ModelReply> {
  const msgs: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.toolCalls?.length) msgs.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
    else msgs.push({ role: m.role, content: m.content });
  }
  const body: any = { model: p.model, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) } }));
  const j = await post(`${trim(p.baseUrl!)}/chat/completions`, p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, body, signal);
  const m = j.choices?.[0]?.message ?? {};
  return { text: m.content ?? '', toolCalls: (m.tool_calls ?? []).map((c: any) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })) };
}

async function anthropic(p: Conn, system: string, messages: Msg[], tools: ToolSpec[], signal?: AbortSignal): Promise<ModelReply> {
  const msgs: any[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = msgs[msgs.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block); else msgs.push({ role: 'user', content: [block] });
    } else if (m.toolCalls?.length) {
      msgs.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] });
    } else msgs.push({ role: m.role, content: m.content });
  }
  const body: any = { model: p.model, max_tokens: 8192, system, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: cleanSchema(t.parameters) }));
  const j = await post(`${trim(p.baseUrl || 'https://api.anthropic.com')}/v1/messages`, { 'x-api-key': p.apiKey ?? '', 'anthropic-version': '2023-06-01' }, body, signal);
  return {
    text: (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''),
    toolCalls: (j.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, args: b.input })),
  };
}

/**
 * A command-line assistant (your own plan). It is an agent itself and runs its own tools; Claude Code also
 * gets this app's tools over MCP. "trust" lets it act without asking, since a command-line run has nobody to answer.
 */
function cli(p: Conn, system: string, messages: Msg[], signal?: AbortSignal, botId?: string): Promise<ModelReply> {
  const transcript = messages.filter((m) => m.role !== 'tool').slice(-30).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;
  let command = p.command!;
  const tmp: string[] = [];
  if (/^\s*claude\b/.test(command)) {
    if (botId) {
      const f = path.join(os.tmpdir(), `krishbot-mcp-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(f, JSON.stringify({ mcpServers: { hq: { type: 'http', url: `${env.mcpBaseUrl}/mcp/${botId}`, headers: { Authorization: `Bearer ${mcpToken(botId)}` } } } }), { mode: 0o600 });
      tmp.push(f); command += ` --mcp-config "${f}"`;
    }
    if (p.trust) command += ' --dangerously-skip-permissions';
  } else if (/^\s*codex\b/.test(command) && p.trust) command += ' --full-auto';
  else if (/^\s*gemini\b/.test(command) && p.trust) command += ' --yolo --skip-trust';
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' }, cwd: os.homedir() });
    let out = '', err = '';
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      tmp.forEach((f) => fs.rmSync(f, { force: true }));
      if (signal?.aborted) return reject(new Error('Stopped'));
      if (code === 0 && out.trim()) resolve({ text: out.trim(), toolCalls: [] });
      else reject(new Error(`"${p.command!.split(' ')[0]}" failed (${code}). ${err.trim().slice(0, 400) || 'Is it installed and signed in?'}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export function callModel(p: Conn, system: string, messages: Msg[], tools: ToolSpec[], opts: { signal?: AbortSignal; botId?: string } = {}): Promise<ModelReply> {
  if (p.type === 'anthropic') return anthropic(p, system, messages, tools, opts.signal);
  if (p.type === 'cli') return cli(p, system, messages, opts.signal, opts.botId);
  return openai(p, system, messages, tools, opts.signal);
}

// ---------- live model list ----------

export async function listModels(p: Conn): Promise<{ models: string[]; free: string[] }> {
  if (p.type === 'cli') return { models: [], free: [] };
  const url = p.type === 'anthropic' ? `${trim(p.baseUrl || 'https://api.anthropic.com')}/v1/models?limit=100` : `${trim(p.baseUrl!)}/models`;
  const headers: Record<string, string> = p.type === 'anthropic' ? { 'x-api-key': p.apiKey ?? '', 'anthropic-version': '2023-06-01' } : p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`The model service answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const list: any[] = ((await r.json()) as any).data ?? [];
  const id = (m: any) => String(m.id ?? m.name ?? '').replace(/^models\//, '');
  const free = list.filter((m) => id(m).endsWith(':free') || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)).map(id);
  return { models: [...new Set([...free, ...list.map(id)])].filter(Boolean), free };
}
