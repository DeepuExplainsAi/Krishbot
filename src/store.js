import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dataDir = process.env.KRISHBOT_DATA || path.join(os.homedir(), '.krishbot');
fs.mkdirSync(path.join(dataDir, 'chats'), { recursive: true });
const cfgFile = path.join(dataDir, 'config.json');

const DEFAULT = {
  autoApprove: false,
  providers: [],
  bots: [{ id: 'main', name: 'Krishbot', prompt: 'You are Krishbot, a helpful assistant working on the user\'s own computer. Use tools when they help. Be concise.', providerId: '', tools: ['shell', 'files', 'web', 'memory'] }],
  customTools: [],
  mcpServers: [],
  routines: [],
};

const write = (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };

export function getConfig() {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch { return structuredClone(DEFAULT); }
}
export const saveConfig = (c) => write(cfgFile, c);

const chatFile = (id) => path.join(dataDir, 'chats', `${id.replace(/[^\w-]/g, '_')}.json`);
export function getChat(id) { try { return JSON.parse(fs.readFileSync(chatFile(id), 'utf8')); } catch { return []; } }
export const saveChat = (id, msgs) => write(chatFile(id), msgs);
export const clearChat = (id) => fs.rmSync(chatFile(id), { force: true });

const safe = (id) => id.replace(/[^\w-]/g, '_');
fs.mkdirSync(path.join(dataDir, 'memory'), { recursive: true });
const memFile = (id) => path.join(dataDir, 'memory', `${safe(id)}.md`);
export const getMemory = (id) => { try { return fs.readFileSync(memFile(id), 'utf8'); } catch { return ''; } };
export const addMemory = (id, text) => fs.appendFileSync(memFile(id), `- ${text.replace(/\n+/g, ' ')}\n`);

const stateFile = path.join(dataDir, 'routines-state.json');
export const getRoutineState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
export const saveRoutineState = (s) => write(stateFile, s);
