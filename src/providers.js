import { spawn } from 'node:child_process';

// One call to a model. Returns { text, toolCalls: [{id,name,args}] }.
// `messages` use one neutral shape: {role:'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name?}
// `tools`: [{name, description, parameters}]

const trim = (u) => u.replace(/\/+$/, '');

async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Model API ${r.status}: ${t.slice(0, 500)}`);
  return JSON.parse(t);
}

async function openai(p, system, messages, tools) {
  const msgs = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') msgs.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.toolCalls?.length) msgs.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
    else msgs.push({ role: m.role, content: m.content });
  }
  const body = { model: p.model, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const j = await post(`${trim(p.baseUrl)}/chat/completions`, p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, body);
  const m = j.choices?.[0]?.message ?? {};
  return {
    text: m.content ?? '',
    toolCalls: (m.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })),
  };
}

async function anthropic(p, system, messages, tools) {
  const msgs = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = msgs[msgs.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else msgs.push({ role: 'user', content: [block] });
    } else if (m.toolCalls?.length) {
      msgs.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] });
    } else msgs.push({ role: m.role, content: m.content });
  }
  const body = { model: p.model, max_tokens: 4096, system, messages: msgs };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const j = await post(`${trim(p.baseUrl || 'https://api.anthropic.com')}/v1/messages`, { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }, body);
  return {
    text: (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
    toolCalls: (j.content ?? []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })),
  };
}

// A command-line assistant you already signed in to (your own subscription). The prompt goes to stdin.
function cli(p, system, messages) {
  const transcript = messages.filter((m) => m.role !== 'tool').map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;
  return new Promise((resolve, reject) => {
    const child = spawn(p.command, { shell: true, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ text: out.trim(), toolCalls: [] }) : reject(new Error(`Command failed (${code}): ${err.slice(0, 500)}`))));
    child.stdin.end(prompt);
  });
}

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

export function callModel(p, system, messages, tools) {
  if (!p) throw new Error('No model connection is set for this bot. Open Settings, add a connection, and pick it for the bot.');
  if (p.type === 'anthropic') return anthropic(p, system, messages, tools);
  if (p.type === 'cli') return cli(p, system, messages);
  return openai(p, system, messages, tools);
}
