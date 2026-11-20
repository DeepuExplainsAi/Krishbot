import { callModel } from './providers.js';
import { builtinTools, appTools, obj, str } from './tools.js';
import { PRESETS, binFound } from './presets.js';
import { state, save, transcript, saveTranscript, dropTranscript, uid, now, libraryDir } from './store.js';
import { emit } from './hub.js';
import { nextRun, normalize, localZone } from './routines.js';

const COMPACT_AT = 80_000;
const STEP_CAP = { low: 6, medium: 14, high: 24, xhigh: 40 };
const clipText = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ---------------- live state, rows ----------------
const live = new Map();
export const getLive = (botId) => live.get(botId) ?? { botId, isRunning: false, activity: null, awaiting: null, startedAt: null, steps: 0 };
function setLive(botId, patch) { const s = { ...getLive(botId), ...patch }; live.set(botId, s); emit({ type: 'live', state: s }); }

export const bot = (id) => state.bots.find((b) => b.id === id);
export function publishBot(b) { emit({ type: 'bot', bot: b }); save(); }

function addRow(botId, kind, body) {
  const t = transcript(botId);
  const row = { botId, generation: t.generation, seq: t.nextSeq++, updatedSeq: ++t.updated, kind, body, createdAt: now() };
  t.rows.push(row);
  emit({ type: 'rows', botId, generation: t.generation, rows: [row] });
  saveTranscript(botId);
  return row;
}
function updateRow(row, patch) {
  const t = transcript(row.botId);
  row.body = { ...row.body, ...patch };
  row.updatedSeq = ++t.updated;
  emit({ type: 'rows', botId: row.botId, generation: t.generation, rows: [row] });
  saveTranscript(row.botId);
}
const notice = (botId, text, tone = 'info') => addRow(botId, 'notice', { type: 'notice', text, tone });

function touch(b, preview, unread) {
  b.lastActivityAt = now();
  if (preview !== undefined) b.lastPreview = clipText(preview.replace(/\s+/g, ' '), 140);
  if (unread) b.unread = (b.unread || 0) + 1;
  publishBot(b);
}

// ---------------- models ----------------
export function providerList() {
  return PRESETS.map((p) => {
    const c = state.connections.find((x) => x.id === p.id);
    const connected = p.type === 'cli' ? !!(c?.command || p.command) && (p.bin ? binFound(p.bin) : !!c?.command) : p.needsKey ? !!c?.apiKey : !!c;
    return { id: p.id, name: p.label, kind: p.type === 'cli' ? 'subscription' : 'api_key', connected, models: p.models ?? [], group: p.group };
  });
}
export function resolveConnection(b) {
  const list = providerList();
  const id = b.provider && list.find((p) => p.id === b.provider)?.connected ? b.provider : list.find((p) => p.connected && state.connections.some((c) => c.id === p.id))?.id ?? list.find((p) => p.connected)?.id;
  if (!id) return null;
  const preset = PRESETS.find((p) => p.id === id), c = state.connections.find((x) => x.id === id) ?? {};
  return { ...preset, ...c, id, model: b.model || c.model || preset.model, trust: c.trust ?? true, command: c.command || preset.command };
}

// ---------------- approvals and questions ----------------
const approvals = new Map(); // approvalId -> { botId, cardRow, callRow, resolve }
const questions = new Map(); // botId -> { row, resolve }
const controllers = new Map(); // botId -> AbortController

const isAlways = (tool) => state.policies.some((p) => p.tool === tool && p.mode === 'always_allow');

export function decide(approvalId, decision) {
  const a = approvals.get(approvalId);
  if (!a) throw new Error('This request has already been answered.');
  approvals.delete(approvalId);
  if (decision === 'always' && !isAlways(a.cardRow.body.tool)) { state.policies.push({ tool: a.cardRow.body.tool, mode: 'always_allow' }); save(); }
  updateRow(a.cardRow, { status: decision === 'allow' ? 'allowed' : decision === 'always' ? 'always' : 'denied' });
  a.resolve(decision !== 'deny');
}

export function answerQuestion(botId, seq, answer, status = 'answered') {
  const q = questions.get(botId);
  if (!q || q.row.seq !== seq) throw new Error('This question was already handled.');
  questions.delete(botId);
  updateRow(q.row, status === 'dismissed' ? { status } : { status, answer });
  q.resolve(status === 'dismissed' ? '(The user skipped the question.)' : answer);
}

function waitFor(botId, reason, register) {
  setLive(botId, { awaiting: { reason, since: now() }, activity: { kind: 'waiting_for_you', since: now() } });
  return register().finally(() => setLive(botId, { awaiting: null, activity: { kind: 'working', since: now() } }));
}

function askApproval(b, tool, call, callRow, signal) {
  const approvalId = uid('apv_');
  const args = call.args ?? {};
  const detail = Object.entries(args).map(([k, v]) => `${k}: ${clipText(typeof v === 'string' ? v : JSON.stringify(v), 300)}`).join('\n');
  const cardRow = addRow(b.id, 'card', { type: 'card', card: 'approval', approvalId, title: callRow.body.label, detail, tool: tool.name, toolkit: tool.toolkit, toolkitName: tool.appName, args, status: 'pending' });
  updateRow(callRow, { status: 'awaiting-approval' });
  return waitFor(b.id, callRow.body.label, () => new Promise((resolve) => {
    const finish = (ok) => resolve(ok);
    approvals.set(approvalId, { botId: b.id, cardRow, callRow, resolve: finish });
    const expire = () => { if (approvals.delete(approvalId)) { updateRow(cardRow, { status: 'expired' }); finish(false); } };
    signal.addEventListener('abort', expire, { once: true });
    setTimeout(expire, 60 * 60_000).unref();
  }));
}

// ---------------- agent tools: memory, tasks, routines, team, questions ----------------
function agentTools(b, depth, signal) {
  const tools = [
    { name: 'save_memory', activity: 'remembering', label: () => 'Saving to memory', description: 'Remember a lasting fact or preference about the user or their work. One short sentence. Do not save secrets.', parameters: obj({ text: str('What to remember') }, ['text']),
      run: ({ text }) => { state.memories.push({ id: uid('mem_'), botId: b.id, text: clipText(text, 400), createdAt: now(), source: 'chat' }); save(); emit({ type: 'memories', botId: b.id }); return 'Saved.'; } },
    { name: 'add_task', activity: 'working', label: (a) => `Adding task: ${clipText(a.title, 50)}`, description: 'Add a task to the user\'s task list for work you are doing or need from them.', parameters: obj({ title: str('Short title'), state: { type: 'string', enum: ['working', 'needs_input', 'done'] }, note: str('Detail') }, ['title']),
      run: ({ title, state: st, note }) => { const t = { id: uid('tsk_'), botId: b.id, title: clipText(title, 120), state: st || 'working', note: note || '', updatedAt: now() }; state.tasks.push(t); save(); emit({ type: 'tasks', botId: b.id }); return `Task ${t.id} added.`; } },
    { name: 'update_task', activity: 'working', label: () => 'Updating a task', description: 'Change a task\'s state or note.', parameters: obj({ id: str('Task id'), state: { type: 'string', enum: ['working', 'needs_input', 'done'] }, note: str('Detail') }, ['id']),
      run: ({ id, state: st, note }) => { const t = state.tasks.find((x) => x.id === id && x.botId === b.id); if (!t) return 'No such task.'; if (st) t.state = st; if (note !== undefined) t.note = note; t.updatedAt = now(); save(); emit({ type: 'tasks', botId: b.id }); return 'Updated.'; } },
    { name: 'create_routine', activity: 'working', label: (a) => `Scheduling “${clipText(a.name, 40)}”`, risky: true,
      description: 'Create a recurring job that runs this prompt on a schedule while Krishbot is open. Schedule is 5-field cron in local time, e.g. "0 8 * * 1-5" = weekdays 8:00, "*/30 * * * *" = every 30 minutes.',
      parameters: obj({ name: str('Short name'), prompt: str('What to do each time'), schedule: str('Cron expression'), description: str('Plain words, e.g. "Weekdays at 8:00 AM"') }, ['name', 'prompt', 'schedule']),
      run: ({ name, prompt, schedule, description }) => { const r = addRoutine(b.id, { name, prompt, schedule, description }); return `Routine ${r.id} created. Next run ${new Date(r.nextRunAt).toLocaleString()}.`; } },
    { name: 'delete_routine', activity: 'working', label: () => 'Removing a routine', risky: true, description: 'Delete a routine by id.', parameters: obj({ id: str('Routine id') }, ['id']),
      run: ({ id }) => (removeRoutine(id) ? 'Deleted.' : 'No such routine.') },
    { name: 'list_routines', activity: 'working', label: () => 'Checking routines', description: 'List this bot\'s routines.', parameters: obj({}),
      run: () => JSON.stringify(state.routines.filter((r) => r.botId === b.id).map(({ id, name, schedule, enabled, prompt }) => ({ id, name, schedule, enabled, prompt }))) },
    { name: 'ask_user', activity: 'waiting_for_you', label: (a) => `Asking: ${clipText(a.question, 60)}`, description: 'Ask the user a question and wait for the answer. Offer 2-4 short options when sensible.', parameters: obj({ question: str('The question'), options: { type: 'array', items: { type: 'string' }, description: 'Suggested answers' } }, ['question']),
      run: ({ question, options }) => waitFor(b.id, question, () => new Promise((resolve) => {
        const row = addRow(b.id, 'card', { type: 'card', card: 'question', question, options: (options || []).slice(0, 6).map(String), status: 'pending' });
        questions.set(b.id, { row, resolve });
        signal.addEventListener('abort', () => { if (questions.get(b.id)?.row === row) { questions.delete(b.id); updateRow(row, { status: 'dismissed' }); resolve('(stopped)'); } }, { once: true });
      })) },
  ];
  const others = state.bots.filter((x) => x.id !== b.id && x.kind !== 'room');
  if (depth === 0 && others.length) tools.push({
    name: 'ask_bot', activity: 'messaging_named', label: (a) => `Asking ${a.bot_name}`,
    description: `Send a request to another bot and get its answer. Bots: ${others.map((x) => `${x.name}${x.label ? ` (${x.label})` : ''}`).join(', ')}.`,
    parameters: obj({ bot_name: str('Bot name'), message: str('What to ask or hand over') }, ['bot_name', 'message']),
    run: async ({ bot_name, message }) => {
      const other = others.find((x) => x.name.toLowerCase() === String(bot_name).toLowerCase());
      if (!other) return `No bot named ${bot_name}.`;
      return (await runTurn(other.id, `${message}`, { from: { kind: 'bot', id: b.id, name: b.name }, depth: depth + 1 })) || '(no answer)';
    },
  });
  return tools;
}

// ---------------- routines (data) ----------------
export function addRoutine(botId, { name, prompt, schedule, description }) {
  const cron = normalize(schedule);
  const next = nextRun(cron);
  if (!next) throw new Error('That schedule never runs.');
  const r = { id: uid('rtn_'), botId, name: clipText(name, 80), prompt, schedule: cron, timezone: localZone(), enabled: true, nextRunAt: next, lastRunAt: null, description: description || '' };
  state.routines.push(r); save(); emit({ type: 'routines', botId });
  return r;
}
export function removeRoutine(id) {
  const i = state.routines.findIndex((r) => r.id === id);
  if (i < 0) return false;
  const [r] = state.routines.splice(i, 1); save(); emit({ type: 'routines', botId: r.botId });
  return true;
}
export function runRoutineNow(r) {
  r.lastRunAt = now(); r.nextRunAt = nextRun(r.schedule); save(); emit({ type: 'routines', botId: r.botId });
  return runTurn(r.botId, r.prompt, { from: { kind: 'routine', id: r.id, name: r.name } }).catch(() => {});
}
export function tickRoutines() {
  for (const r of state.routines) {
    if (!r.enabled || !r.nextRunAt || r.nextRunAt > now()) continue;
    if (now() - r.nextRunAt > 10 * 60_000) { r.nextRunAt = nextRun(r.schedule); save(); continue; } // missed while the app was closed
    runRoutineNow(r);
  }
}

// ---------------- the turn ----------------
function systemPrompt(b, conn) {
  const mem = state.memories.filter((m) => m.botId === b.id).map((m) => `- ${m.text}`).join('\n');
  const skills = state.skills.filter((s) => s.botId === b.id).map((s) => `## Skill: ${s.name}\n${s.description ? `When: ${s.description}\n` : ''}${s.body}`).join('\n\n');
  const user = state.settings.userName ? `The user's name is ${state.settings.userName}.` : '';
  return [
    `You are ${b.name}${b.label ? `, ${b.label}` : ''}, an AI ${b.mode === 'teammate' ? 'teammate' : 'assistant'} running on the user's own computer through Krishbot. ${user}`,
    b.description && `Your purpose: ${b.description}`,
    b.instructions && `Instructions from the user:\n${b.instructions}`,
    `Today is ${new Date().toString()}. Files you create are kept in ${libraryDir(b.id)} (the user sees them in the Library tab).`,
    'Use your tools to get things done instead of only describing them. Be concise. Ask the user (ask_user) only when you truly cannot proceed. Save lasting preferences with save_memory.',
    mem && `Things you remember:\n${mem}`,
    skills,
  ].filter(Boolean).join('\n\n');
}

const size = (llm) => llm.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.toolCalls || '').length, 0);

async function compact(b, conn, t, signal) {
  if (size(t.llm) < COMPACT_AT) return;
  let cut = t.llm.length - 10;
  while (cut < t.llm.length && (t.llm[cut].role !== 'user')) cut++;
  if (cut <= 2 || cut >= t.llm.length) return;
  const old = t.llm.slice(0, cut), rest = t.llm.slice(cut);
  let summary, method = 'summary';
  try {
    const text = old.filter((m) => m.role !== 'tool').map((m) => `${m.role}: ${m.content}`).join('\n').slice(-60_000);
    const r = await callModel(conn, 'Summarize this conversation for yourself: decisions, facts about the user, open tasks, key results. Under 400 words.', [{ role: 'user', content: text }], [], { signal });
    summary = r.text;
  } catch { method = 'trim'; }
  t.llm = [...(summary ? [{ role: 'user', content: `[Summary of the earlier conversation]\n${summary}` }, { role: 'assistant', content: 'Understood.' }] : []), ...rest];
  state.compaction[b.id] = { lastConsolidatedAt: now(), lastCompaction: { method, created_at: now() } };
  save();
}

export function memoryStats(botId) {
  const c = state.compaction[botId] ?? {};
  return { lastConsolidatedAt: c.lastConsolidatedAt ?? null, historyChars: size(transcript(botId).llm), compactAtChars: COMPACT_AT, lastCompaction: c.lastCompaction ?? null };
}

const chains = new Map();
/** Queue a message for a bot; resolves with its final reply text. */
export function runTurn(botId, text, opts = {}) {
  const b = bot(botId);
  if (!b) return Promise.reject(new Error('Unknown bot'));
  if (b.kind === 'room') return runRoom(b, text);
  const p = (chains.get(botId) ?? Promise.resolve()).catch(() => {}).then(() => turn(b, text, opts));
  chains.set(botId, p);
  return p;
}

async function turn(b, text, { from, depth = 0 }) {
  const t = transcript(b.id);
  const ctl = new AbortController();
  controllers.set(b.id, ctl);
  const signal = ctl.signal;
  addRow(b.id, 'message', { type: 'message', role: 'user', text, ...(from ? { from } : {}) });
  t.llm.push({ role: 'user', content: from?.kind === 'bot' ? `[Message from ${from.name}] ${text}` : from?.kind === 'routine' ? `[Scheduled routine "${from.name}"] ${text}` : text });
  touch(b, text);
  setLive(b.id, { isRunning: true, activity: { kind: 'thinking', since: now() }, awaiting: null, startedAt: now(), steps: 0 });
  let finalText = '';
  try {
    const conn = resolveConnection(b);
    if (!conn) throw new Error('No model is connected yet. Open Settings → Models and connect one (a free option works).');
    const agentCli = conn.type === 'cli';
    const { tools: appT, errors, servers } = await appTools();
    errors.forEach((e) => notice(b.id, e, 'warn'));
    const tools = agentCli ? [] : [...builtinTools(b), ...agentTools(b, depth, signal), ...appT];
    const mcpServers = agentCli ? servers.concat(state.bots.length ? [ownMcp(b)].filter(Boolean) : []) : [];
    const system = systemPrompt(b, conn);
    const cap = STEP_CAP[b.effort] ?? 14;
    for (let step = 0; step < cap; step++) {
      if (signal.aborted) throw new Error('Stopped');
      await compact(b, conn, t, signal);
      const reply = await callModel(conn, system, t.llm, tools, { signal, mcpServers });
      t.llm.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
      if (reply.text) { addRow(b.id, 'message', { type: 'message', role: 'assistant', text: reply.text }); finalText = reply.text; touch(b, reply.text, true); }
      if (!reply.toolCalls.length) break;
      for (const call of reply.toolCalls) {
        const tool = tools.find((x) => x.name === call.name);
        const row = addRow(b.id, 'tool-call', { type: 'tool-call', callId: call.id, name: call.name, label: tool ? tool.label(call.args ?? {}) : call.name, status: 'running', args: call.args });
        setLive(b.id, { activity: { kind: tool?.activity ?? 'working', since: now() }, steps: getLive(b.id).steps + 1 });
        let result, status = 'done';
        if (!tool) { result = `There is no tool called ${call.name}.`; status = 'error'; }
        else if (tool.risky && !state.settings.autoApprove && !isAlways(tool.name) && !(await askApproval(b, tool, call, row, signal))) { result = 'The user did not allow this action.'; status = 'denied'; }
        else {
          if (row.body.status !== 'running') updateRow(row, { status: 'running' });
          try { result = String(await tool.run(call.args ?? {}, { signal })); } catch (e) { result = `Error: ${e.message}`; status = 'error'; }
        }
        updateRow(row, { status, summary: clipText(result.replace(/\s+/g, ' '), 140) });
        t.llm.push({ role: 'tool', toolCallId: call.id, content: result });
        if (signal.aborted) throw new Error('Stopped');
      }
      if (step === cap - 1) notice(b.id, 'Stopped after the step limit for this Bot’s effort level. Send another message to continue.', 'warn');
    }
  } catch (e) {
    if (signal.aborted) notice(b.id, 'Stopped.');
    else notice(b.id, e.message, 'error');
  } finally {
    controllers.delete(b.id);
    for (const [id, a] of [...approvals]) if (a.botId === b.id) { approvals.delete(id); updateRow(a.cardRow, { status: 'expired' }); a.resolve(false); }
    setLive(b.id, { isRunning: false, activity: null, awaiting: null, startedAt: null });
    saveTranscript(b.id);
  }
  return finalText;
}

export function interrupt(botId) {
  controllers.get(botId)?.abort();
  const q = questions.get(botId);
  if (q) answerQuestion(botId, q.row.seq, '', 'dismissed');
}

/** The user typed while a question card was open: treat the text as the answer. */
export function maybeAnswerPending(botId, text) {
  const q = questions.get(botId);
  if (!q) return false;
  addRow(botId, 'message', { type: 'message', role: 'user', text });
  answerQuestion(botId, q.row.seq, text);
  return true;
}

// ---------------- group chats ----------------
async function runRoom(room, text) {
  const members = (state.members[room.id] ?? []).map(bot).filter(Boolean);
  addRow(room.id, 'message', { type: 'message', role: 'user', text });
  touch(room, text);
  setLive(room.id, { isRunning: true, activity: { kind: 'working', since: now() }, startedAt: now(), steps: 0 });
  try {
    for (const m of members) {
      const recent = transcript(room.id).rows.filter((r) => r.body.type === 'message').slice(-10).map((r) => `${r.body.role === 'user' ? 'User' : r.body.from?.name ?? 'Bot'}: ${r.body.text}`).join('\n');
      const reply = await runTurn(m.id, `[Group chat "${room.name}" with ${members.map((x) => x.name).join(', ')}]\n${recent}\n\nReply as ${m.name}. Keep it short and only add what the others have not.`, { from: { kind: 'bot', id: room.id, name: room.name } });
      if (reply) { addRow(room.id, 'message', { type: 'message', role: 'assistant', text: reply, from: { kind: 'bot', id: m.id, name: m.name } }); touch(room, reply, true); }
    }
    if (!members.length) notice(room.id, 'This group has no members yet.', 'warn');
  } finally { setLive(room.id, { isRunning: false, activity: null, startedAt: null }); }
  return '';
}

// ---------------- bots ----------------
export function createBot(p, extra = {}) {
  const b = {
    id: uid('bot_'), name: p.name, label: p.label ?? '', description: p.description ?? '', instructions: p.instructions ?? '', avatarShape: p.avatarShape ?? 'blob', avatarColor: p.avatarColor ?? 'black',
    mode: p.mode ?? 'personal', isPrimary: false, kind: 'agent', pinned: false, effort: 'medium', voice: '', voiceSpeed: 1, voiceLanguage: 'auto', model: null, provider: null,
    generation: 1, unread: 0, lastPreview: null, lastActivityAt: now(), createdAt: now(), ...extra,
  };
  state.bots.push(b); save(); emit({ type: 'roster' });
  return b;
}
export function deleteBot(id) {
  controllers.get(id)?.abort();
  state.bots = state.bots.filter((b) => b.id !== id);
  for (const k of ['memories', 'skills', 'routines', 'tasks']) state[k] = state[k].filter((x) => x.botId !== id);
  delete state.members[id];
  for (const m of Object.values(state.members)) { const i = m.indexOf(id); if (i >= 0) m.splice(i, 1); }
  dropTranscript(id); save(); emit({ type: 'roster' });
}
export function freshChat(id) {
  const t = transcript(id);
  t.generation++; t.rows = []; t.nextSeq = 1; t.llm = [];
  saveTranscript(id);
  const b = bot(id); if (b) { b.lastPreview = null; b.generation = t.generation; publishBot(b); }
  emit({ type: 'cleared', botId: id, generation: t.generation });
}

if (!state.bots.length) createBot({ name: 'Krishbot', label: 'Chief of Staff', description: 'Your main point of contact. Coordinates work with your other Bots.' }, { isPrimary: true });

// Our own tool server for command-line agents (set by server.js once it is listening).
let ownMcpFn = null;
export const setOwnMcp = (fn) => { ownMcpFn = fn; };
const ownMcp = (b) => ownMcpFn?.(b);
export { agentTools };
