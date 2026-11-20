import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// callModel(connection, system, messages, tools, opts) -> { text, toolCalls: [{id,name,args}] }
// Neutral messages: {role:'user'|'assistant'|'tool', content, toolCalls?, toolCallId?}

const trim = (u) => u.replace(/\/+$/, '');
const safeJson = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

async function post(url, headers, body, signal) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const t = await r.text();
  if (!r.ok) throw new Error(`The model service answered ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

async function openai(p, system, messages, tools, { signal }) {
  const msgs = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.toolCalls?.length) msgs.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
    else msgs.push({ role: m.role, content: m.content });
  }
  const body = { model: p.model, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const j = await post(`${trim(p.baseUrl)}/chat/completions`, p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, body, signal);
  const m = j.choices?.[0]?.message ?? {};
  return { text: m.content ?? '', toolCalls: (m.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })) };
}

async function anthropic(p, system, messages, tools, { signal }) {
  const msgs = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = msgs[msgs.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block); else msgs.push({ role: 'user', content: [block] });
    } else if (m.toolCalls?.length) {
      msgs.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] });
    } else msgs.push({ role: m.role, content: m.content });
  }
  const body = { model: p.model, max_tokens: 4096, system, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const j = await post(`${trim(p.baseUrl || 'https://api.anthropic.com')}/v1/messages`, { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }, body, signal);
  return {
    text: (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
    toolCalls: (j.content ?? []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })),
  };
}

// A command-line assistant you already signed in to (your own plan). It is an agent itself: it runs its own tools.
// "trust" lets it act without asking, because a command-line run has nobody to answer its questions.
function cli(p, system, messages, _tools, { signal, mcpServers = [] }) {
  const transcript = messages.filter((m) => m.role !== 'tool').slice(-30).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;
  let command = p.command;
  const tmp = [];
  if (/^\s*claude\b/.test(command)) {
    if (mcpServers.length) {
      const f = path.join(os.tmpdir(), `krishbot-mcp-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(f, JSON.stringify({ mcpServers: Object.fromEntries(mcpServers.map((s) => [s.name, s.url ? { type: 'http', url: s.url, headers: s.headers || {} } : { command: s.command, args: s.args || [], env: s.env || {} }])) }), { mode: 0o600 });
      tmp.push(f); command += ` --mcp-config "${f}"`;
    }
    if (p.trust) command += ' --dangerously-skip-permissions';
  } else if (/^\s*codex\b/.test(command) && p.trust) command += ' --full-auto';
  else if (/^\s*gemini\b/.test(command) && p.trust) command += ' --yolo';
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, env: process.env, cwd: os.homedir() });
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
      else reject(new Error(`"${p.command.split(' ')[0]}" failed (${code}). ${err.trim().slice(0, 400) || 'Is it installed and signed in?'}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export function callModel(p, system, messages, tools, opts = {}) {
  if (!p) throw new Error('No model is connected yet. Open Settings → Models and add one.');
  if (p.type === 'anthropic') return anthropic(p, system, messages, tools, opts);
  if (p.type === 'cli') return cli(p, system, messages, tools, opts);
  return openai(p, system, messages, tools, opts);
}
export const isAgentCli = (p) => p?.type === 'cli';
