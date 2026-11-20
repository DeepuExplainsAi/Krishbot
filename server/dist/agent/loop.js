import { db, now } from '../db.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { appendRow, emitBot, getBotRow, getLive, getRow, setLive, updateRow } from '../store.js';
import { appInfo } from '../apps.js';
import { engineFor } from '../engine.js';
import { instructionsFor } from './prompt.js';
import { activityFor, appToolName, humanizeSlug } from './tools.js';
// ---------- per-bot serial queue ----------
const queues = new Map();
const aborts = new Map();
export function enqueue(botId, trigger) {
    // A new message from the user supersedes whatever is waiting for their approval.
    if (trigger.type === 'user')
        expireApprovals(botId);
    const prev = queues.get(botId) ?? Promise.resolve();
    const next = prev.then(() => runTurn(botId, trigger)).catch((e) => console.error('[agent] turn failed', botId, e));
    queues.set(botId, next);
    next.finally(() => { if (queues.get(botId) === next)
        queues.delete(botId); });
}
export function interrupt(botId) {
    expireApprovals(botId);
    aborts.get(botId)?.abort();
}
/** Run a job in the bot's serial queue, after any running turn. */
export function runInBotQueue(botId, job) {
    const prev = queues.get(botId) ?? Promise.resolve();
    const result = prev.then(job);
    const next = result.then(() => { }, () => { });
    queues.set(botId, next);
    next.finally(() => { if (queues.get(botId) === next)
        queues.delete(botId); });
    return result;
}
export const isBotBusy = (botId) => queues.has(botId);
export function enqueueBotMessage(fromBotId, toBotId, text, depth) {
    const from = getBotRow(fromBotId);
    appendRow(toBotId, 'message', { type: 'message', role: 'user', text, from: { kind: 'bot', id: fromBotId, name: from.name } });
    enqueue(toBotId, { type: 'bot', fromBotId, fromName: from.name, text, depth });
}
function triggerText(t) {
    switch (t.type) {
        case 'user': return t.text;
        case 'routine': return `[Routine "${t.name}" is running now. Do this:]\n${t.prompt}`;
        case 'bot': return `[Message from ${t.fromName}, another Bot on the team. Reply to them with send_to_bot if they asked you something.]\n${t.text}`;
        case 'system': return `[System notice] ${t.text}`;
    }
}
const turns = new Map();
export const turnDepth = (botId) => turns.get(botId)?.depth ?? 0;
export function markSilent(botId) {
    const t = turns.get(botId);
    if (t)
        t.silent = true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * An app tool was called through MCP: find the tool-call row the event stream made for it.
 * The stream announces a call just before the engine runs it, so wait a moment for the row.
 * Returns null when the call did not come from a turn started here (e.g. the agent used the tool
 * while talking to its owner somewhere else).
 */
export async function claimToolRow(botId, name) {
    const deadline = Date.now() + 600;
    for (;;) {
        const t = turns.get(botId);
        if (!t)
            return null;
        const ref = t.tools.find((r) => !r.claimed && !r.done && r.name === name);
        if (ref) {
            ref.claimed = true;
            return ref.seq;
        }
        if (Date.now() > deadline)
            return null;
        await sleep(40);
    }
}
export function noteToolOutcome(botId, seq, outcome) {
    if (seq === null)
        return;
    turns.get(botId)?.outcomes.set(seq, outcome);
    patchToolRow(botId, seq, outcome);
}
function patchToolRow(botId, seq, patch) {
    const row = getRow(botId, seq);
    if (row && row.body.type === 'tool-call')
        updateRow(botId, seq, { ...row.body, ...patch });
}
/** Longest a tool call waits for the user. Kept under the engines' 30 minute tool timeout. */
const APPROVAL_WAIT_MS = 25 * 60_000;
const waiters = new Map();
function setApprovalCard(botId, rowSeq, approvalId, status) {
    const card = getRow(botId, rowSeq);
    if (card && card.body.type === 'card' && card.body.card === 'approval' && card.body.approvalId === approvalId) {
        updateRow(botId, rowSeq, { ...card.body, status });
    }
}
const pendingApprovals = (botId) => db.prepare("SELECT * FROM approvals WHERE bot_id=? AND status='pending'").all(botId);
/** Put an approval card in the conversation and wait for the user's answer. */
export async function requestApproval(who, pol, args, rowSeq) {
    const { userId, botId } = who;
    const approvalId = newId('apr');
    const tk = pol.toolkit ? appInfo(pol.toolkit) : undefined;
    const card = appendRow(botId, 'card', {
        type: 'card', card: 'approval', approvalId, title: `Allow ${getBotRow(botId).name} to ${pol.title.split(': ')[1] ?? pol.title}?`,
        detail: describeArgs(args), tool: pol.key, toolkit: pol.toolkit, toolkitName: tk?.name, args, status: 'pending',
    });
    db.prepare('INSERT INTO approvals(id,bot_id,row_seq,call_id,tool,status,created_at) VALUES (?,?,?,?,?,?,?)').run(approvalId, botId, card.seq, '', pol.key, 'pending', now());
    db.prepare('UPDATE bots SET unread = unread + 1 WHERE id=?').run(botId);
    if (rowSeq !== null)
        patchToolRow(botId, rowSeq, { status: 'awaiting-approval' });
    setLive(botId, { isRunning: false, activity: { kind: 'waiting_for_you', since: now() }, awaiting: { reason: humanizeSlug(pol.key), since: now() } });
    hub.emit(userId, { type: 'tasks', botId });
    emitBot(botId);
    let timer;
    const decision = await new Promise((resolve) => {
        waiters.set(approvalId, { botId, resolve });
        timer = setTimeout(() => expireApproval(approvalId), APPROVAL_WAIT_MS);
    });
    clearTimeout(timer);
    waiters.delete(approvalId);
    if (rowSeq !== null) {
        if (decision === 'allow')
            patchToolRow(botId, rowSeq, { status: 'running' });
        else
            noteToolOutcome(botId, rowSeq, { status: 'denied', summary: decision === 'deny' ? 'Not allowed' : 'Skipped' });
    }
    if (!pendingApprovals(botId).length) {
        if (turns.has(botId))
            setLive(botId, { isRunning: true, activity: { kind: decision === 'allow' ? 'connecting_service' : 'thinking', detail: decision === 'allow' ? tk?.name : undefined, since: now() }, awaiting: null });
        else
            setLive(botId, { isRunning: false, activity: null, awaiting: null, startedAt: null });
    }
    hub.emit(userId, { type: 'tasks', botId });
    return decision;
}
function expireApproval(approvalId) {
    const ap = db.prepare('SELECT * FROM approvals WHERE id=?').get(approvalId);
    if (ap?.status === 'pending') {
        db.prepare("UPDATE approvals SET status='expired', resolved_at=? WHERE id=?").run(now(), approvalId);
        setApprovalCard(ap.bot_id, ap.row_seq, approvalId, 'expired');
    }
    waiters.get(approvalId)?.resolve('expired');
}
export function expireApprovals(botId) {
    for (const ap of pendingApprovals(botId))
        expireApproval(ap.id);
}
/** After a restart nothing is waiting on old approval cards any more. */
export function expireStaleApprovals() {
    for (const ap of db.prepare("SELECT id FROM approvals WHERE status='pending'").all())
        expireApproval(ap.id);
}
/** Resolve an approval card from the UI. */
export function resolveApproval(userId, approvalId, decision) {
    const ap = db.prepare('SELECT a.*, b.user_id FROM approvals a JOIN bots b ON b.id=a.bot_id WHERE a.id=?').get(approvalId);
    if (!ap || ap.user_id !== userId)
        throw new Error('not found');
    if (ap.status !== 'pending')
        return;
    const waiter = waiters.get(approvalId);
    if (!waiter)
        return expireApproval(approvalId);
    const status = decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'allowed';
    db.prepare('UPDATE approvals SET status=?, resolved_at=? WHERE id=?').run(status, now(), approvalId);
    if (decision === 'always')
        db.prepare("INSERT OR REPLACE INTO policies(user_id,tool,mode) VALUES (?,?,'always_allow')").run(userId, ap.tool);
    setApprovalCard(ap.bot_id, ap.row_seq, approvalId, status);
    waiter.resolve(decision === 'deny' ? 'deny' : 'allow');
}
function describeArgs(args) {
    if (!args || typeof args !== 'object')
        return '';
    const inner = Array.isArray(args.tools) ? args.tools.map((t) => t.arguments ?? t.args ?? t) : [args];
    const flat = inner.map((a) => Object.entries(a ?? {}).filter(([, v]) => typeof v !== 'object' || v === null).slice(0, 6).map(([k, v]) => `${k}: ${String(v).slice(0, 160)}`).join('\n'));
    return flat.join('\n\n').slice(0, 1200);
}
async function* sseEvents(body) {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of body) {
        buf = (buf + dec.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let end;
        while ((end = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, end);
            buf = buf.slice(end + 2);
            let event = '';
            const data = [];
            for (const line of frame.split('\n')) {
                if (line.startsWith('event:'))
                    event = line.slice(6).trim();
                else if (line.startsWith('data:'))
                    data.push(line.slice(5).replace(/^ /, ''));
            }
            if (!data.length)
                continue; // a keepalive comment
            const raw = data.join('\n');
            if (raw === '[DONE]')
                continue;
            try {
                const json = JSON.parse(raw);
                yield { type: event || json?.type || '', data: json };
            }
            catch { /* not ours to understand */ }
        }
    }
}
async function failureText(res) {
    const raw = await res.text().catch(() => '');
    try {
        const j = JSON.parse(raw);
        const m = j?.error?.message ?? j?.message ?? j?.error;
        if (typeof m === 'string' && m)
            return m;
    }
    catch { /* plain text */ }
    if (res.status === 401 || res.status === 403)
        return 'the engine did not accept our key';
    return raw.slice(0, 300) || `the engine answered ${res.status}`;
}
/** What a tool's raw result says about how it went. */
function readOutcome(item) {
    const text = Array.isArray(item?.output) ? item.output.map((p) => p?.text ?? '').join('') : String(item?.output ?? '');
    try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object') {
            if (j.error)
                return { status: 'error', summary: String(typeof j.error === 'string' ? j.error : JSON.stringify(j.error)).slice(0, 200) };
            if (typeof j.exit_code === 'number' && j.exit_code !== 0)
                return { status: 'error', summary: `Exit code ${j.exit_code}` };
            if (j.success === false)
                return { status: 'error', summary: String(j.message ?? 'Failed').slice(0, 200) };
        }
    }
    catch { /* not JSON */ }
    if (/^(tool )?error\b/i.test(text.trim()))
        return { status: 'error', summary: text.trim().slice(0, 200) };
    return { status: 'done' };
}
/** A short line for the "thinking" chip out of the model's running reasoning. */
function captionFrom(reasoning) {
    const titles = [...reasoning.matchAll(/\*\*([^*\n]{3,80})\*\*/g)];
    if (titles.length)
        return titles[titles.length - 1][1].trim();
    const para = reasoning.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).pop();
    if (!para)
        return null;
    const sentence = para.split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' ').trim();
    if (sentence.length < 4)
        return null;
    return sentence.length > 84 ? `${sentence.slice(0, 81).trimEnd()}…` : sentence;
}
// ---------- the turn ----------
/** Hermes' own tool lookup (it loads rarely used tools on demand). */
const TOOLBOX = new Set(['tool_search', 'tool_describe']);
async function runTurn(botId, trigger) {
    const bot = getBotRow(botId);
    if (!bot || bot.kind === 'room')
        return;
    const userId = bot.user_id;
    const ctrl = new AbortController();
    aborts.set(botId, ctrl);
    const turn = { botId, userId, depth: trigger.type === 'bot' ? trigger.depth : 0, silent: false, tools: [], outcomes: new Map() };
    turns.set(botId, turn);
    setLive(botId, { isRunning: true, activity: { kind: 'thinking', since: now() }, awaiting: null, startedAt: now(), caption: null, steps: 0 });
    // The assistant message being written right now.
    let msgSeq = null;
    let text = '';
    let lastFlush = 0;
    let wroteText = false;
    const flush = (streaming) => {
        const b = { type: 'message', role: 'assistant', text, streaming };
        if (msgSeq === null)
            msgSeq = appendRow(botId, 'message', b).seq;
        else
            updateRow(botId, msgSeq, b);
        lastFlush = Date.now();
    };
    const closeMessage = () => {
        if (msgSeq === null)
            return;
        if (text.trim()) {
            flush(false);
            db.prepare('UPDATE bots SET unread = unread + 1 WHERE id=?').run(botId);
        }
        else
            updateRow(botId, msgSeq, { type: 'message', role: 'assistant', text: '', streaming: false });
        msgSeq = null;
        text = '';
    };
    const say = (t) => {
        if (turn.silent || !t.trim())
            return;
        closeMessage();
        appendRow(botId, 'message', { type: 'message', role: 'assistant', text: t.trim(), streaming: false });
        db.prepare('UPDATE bots SET unread = unread + 1 WHERE id=?').run(botId);
        wroteText = true;
    };
    let reasoning = '';
    let lastCaption = 0;
    const caption = (c, force = false) => {
        if (!c || c === getLive(botId).caption)
            return;
        if (!force && Date.now() - lastCaption < 300)
            return;
        lastCaption = Date.now();
        setLive(botId, { caption: c });
    };
    const outputsSeen = new Set();
    let steps = 0;
    let failed = false;
    try {
        const engine = await engineFor(botId);
        if (ctrl.signal.aborted)
            throw new Error('interrupted');
        let input = triggerText(trigger);
        const res = await fetch(`${engine.url}/v1/responses`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(engine.key ? { authorization: `Bearer ${engine.key}` } : {}) },
            body: JSON.stringify({
                model: bot.model || 'hermes-agent',
                ...(bot.provider ? { provider: bot.provider } : {}),
                input,
                instructions: await instructionsFor(userId, botId),
                // One engine-side thread per conversation; "New chat" bumps the generation and starts another.
                conversation: `hq-${botId}-g${bot.generation}`,
                stream: true,
                store: true,
                model_options: { reasoning_effort: bot.effort ?? 'medium' },
            }),
        });
        if (!res.ok || !res.body)
            throw new Error(await failureText(res));
        for await (const ev of sseEvents(res.body)) {
            const d = ev.data;
            switch (ev.type) {
                case 'response.output_text.delta': {
                    if (turn.silent || typeof d.delta !== 'string')
                        break;
                    // Models often open with blank lines; a message never starts with them.
                    const piece = text ? d.delta : d.delta.trimStart();
                    if (!piece)
                        break;
                    text += piece;
                    wroteText = true;
                    if (msgSeq === null)
                        setLive(botId, { activity: { kind: 'working', since: now() } });
                    if (msgSeq === null || Date.now() - lastFlush > 120)
                        flush(true);
                    break;
                }
                case 'response.reasoning_summary_text.delta':
                case 'response.reasoning_text.delta': {
                    if (typeof d.delta === 'string') {
                        reasoning = (reasoning + d.delta).slice(-4000);
                        caption(captionFrom(reasoning));
                    }
                    break;
                }
                case 'hermes.status': {
                    if (typeof d?.text === 'string' && d.text.trim())
                        caption(d.text.trim().slice(0, 84), true);
                    break;
                }
                case 'response.output_item.added': {
                    const item = d.item;
                    if (item?.type === 'reasoning') {
                        reasoning = '';
                        if (getLive(botId).activity?.kind !== 'thinking')
                            setLive(botId, { activity: { kind: 'thinking', since: now() } });
                    }
                    if (item?.type === 'function_call') {
                        // Text written before this call is its own message; what follows starts a new one.
                        closeMessage();
                        const { name, ours } = appToolName(String(item.name ?? ''));
                        // The agent looking through its own toolbox is not a step worth showing.
                        if (!ours && TOOLBOX.has(name)) {
                            caption('Finding the right tool', true);
                            break;
                        }
                        const act = activityFor(String(item.name ?? ''));
                        let args;
                        try {
                            args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments;
                        }
                        catch {
                            args = undefined;
                        }
                        const row = appendRow(botId, 'tool-call', { type: 'tool-call', callId: String(item.call_id ?? item.id ?? ''), name, label: act.label, status: 'running', args });
                        turn.tools.push({ seq: row.seq, callId: String(item.call_id ?? item.id ?? ''), name, claimed: false, done: false });
                        steps++;
                        const kind = name === 'send_to_bot' ? 'messaging_named' : act.kind;
                        const detail = name === 'send_to_bot' ? String(args?.bot_name ?? '') || undefined : act.detail;
                        // A call that is waiting for the user keeps its "waiting for you" state.
                        if (!getLive(botId).awaiting)
                            setLive(botId, { isRunning: true, activity: { kind, detail, since: now() }, steps, caption: null });
                        else
                            setLive(botId, { steps });
                        reasoning = '';
                    }
                    break;
                }
                case 'response.output_item.done': {
                    const item = d.item;
                    if (item?.type === 'message') {
                        const full = (item.content ?? []).map((c) => c?.text ?? '').join('');
                        if (item.phase === 'commentary')
                            say(full);
                        else if (msgSeq !== null)
                            closeMessage();
                        else if (!wroteText)
                            say(full);
                    }
                    break;
                }
                case 'response.failed':
                case 'error':
                    throw new Error(d?.response?.error?.message ?? d?.error?.message ?? d?.message ?? 'the agent run failed');
            }
            // A tool result arrives as an item of its own (announced twice: added and done).
            const item = d?.item;
            if (item?.type === 'function_call_output' && item.call_id && !outputsSeen.has(item.call_id)) {
                outputsSeen.add(item.call_id);
                const ref = turn.tools.find((r) => r.callId === item.call_id);
                if (ref) {
                    ref.done = true;
                    const told = turn.outcomes.get(ref.seq);
                    const guess = readOutcome(item);
                    patchToolRow(botId, ref.seq, told?.status && told.status !== 'running' ? told : { status: guess.status, summary: told?.summary ?? guess.summary });
                    if (!getLive(botId).awaiting)
                        setLive(botId, { activity: { kind: 'thinking', since: now() } });
                }
            }
        }
    }
    catch (e) {
        failed = true;
        const stopped = ctrl.signal.aborted;
        closeMessage();
        appendRow(botId, 'notice', { type: 'notice', text: stopped ? 'Stopped.' : `Something went wrong: ${e?.message ?? e}`, tone: stopped ? 'info' : 'error' });
        if (!stopped)
            console.error('[agent]', botId, e);
    }
    finally {
        closeMessage();
        for (const ref of turn.tools) {
            if (ref.done)
                continue;
            const row = getRow(botId, ref.seq);
            if (row?.body.type !== 'tool-call' || (row.body.status !== 'running' && row.body.status !== 'awaiting-approval'))
                continue;
            patchToolRow(botId, ref.seq, failed ? { status: 'error', summary: ctrl.signal.aborted ? 'Stopped' : 'Did not finish' } : { status: 'done' });
        }
        if (aborts.get(botId) === ctrl)
            aborts.delete(botId);
        if (turns.get(botId) === turn)
            turns.delete(botId);
        // An approval asked for outside this turn may still be waiting; leave its state alone.
        if (!pendingApprovals(botId).length)
            setLive(botId, { isRunning: false, activity: null, awaiting: null, startedAt: null, caption: null });
        else
            setLive(botId, { isRunning: false, caption: null });
        emitBot(botId);
    }
}
//# sourceMappingURL=loop.js.map