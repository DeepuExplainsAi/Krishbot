import { callModel } from './providers.js';
import { toolsFor } from './tools.js';
import { getChat, saveChat, getConfig, getMemory } from './store.js';

const pending = new Map(); // approval id -> resolve
let seq = 0;
export const answerApproval = (id, ok) => { pending.get(id)?.(ok); pending.delete(id); };

const MAX_STEPS = 12;

// Runs one user turn. `emit(event)` streams progress to the UI.
export async function runTurn(botId, text, emit, signal, depth = 0) {
  const cfg = getConfig();
  const bot = cfg.bots.find((b) => b.id === botId);
  if (!bot) throw new Error('Unknown bot');
  const provider = cfg.providers.find((p) => p.id === bot.providerId);
  const { tools, errors } = await toolsFor(bot, cfg);
  if ((bot.tools || []).includes('team') && depth === 0) tools.push({
    name: 'ask_bot', description: `Ask another bot on this computer to do something and return its answer. Bots: ${cfg.bots.filter((b) => b.id !== botId).map((b) => b.name).join(', ') || 'none'}.`,
    parameters: { type: 'object', properties: { bot: { type: 'string', description: 'Bot name' }, message: { type: 'string', description: 'What to ask' } }, required: ['bot', 'message'] },
    run: async ({ bot: name, message }) => {
      const other = cfg.bots.find((b) => b.id !== botId && b.name.toLowerCase() === String(name).toLowerCase());
      if (!other) return `No bot named ${name}.`;
      let answer = '';
      await runTurn(other.id, `Message from bot "${bot.name}": ${message}`, (e) => { if (e.type === 'text') answer += e.text + '\n'; else if (e.type === 'approval') answerApproval(e.id, false); }, signal, depth + 1);
      return answer.trim() || '(no answer)';
    },
  });
  const memory = bot.tools?.includes('memory') ? getMemory(botId) : '';
  const system = memory ? `${bot.prompt}\n\nThings you remember:\n${memory}` : bot.prompt;
  const opts = { autoApprove: cfg.autoApprove, mcpServers: (cfg.mcpServers || []).filter((s) => (bot.mcp || []).includes(s.name)) };
  errors.forEach((e) => emit({ type: 'notice', text: e }));

  const messages = getChat(botId);
  messages.push({ role: 'user', content: text });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) throw new Error('Stopped');
      const reply = await callModel(provider, system, messages, tools, opts);
      messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
      if (reply.text) emit({ type: 'text', text: reply.text });
      if (!reply.toolCalls.length) break;
      for (const call of reply.toolCalls) {
        const tool = tools.find((t) => t.name === call.name);
        emit({ type: 'tool', name: call.name, args: call.args });
        let result;
        if (!tool) result = `Unknown tool ${call.name}`;
        else if (tool.risky && !cfg.autoApprove && !(await ask(call, emit, signal))) result = 'The user declined this action.';
        else try { result = await tool.run(call.args); } catch (e) { result = `Error: ${e.message}`; }
        emit({ type: 'result', name: call.name, text: String(result).slice(0, 2000) });
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: String(result) });
      }
    }
  } finally {
    saveChat(botId, messages);
  }
}

function ask(call, emit, signal) {
  const id = String(++seq);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    signal.addEventListener('abort', () => answerApproval(id, false), { once: true });
    emit({ type: 'approval', id, name: call.name, args: call.args });
  });
}
