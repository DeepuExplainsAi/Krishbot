import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const dataDir = process.env.KRISHBOT_DATA || path.join(os.homedir(), '.krishbot');
export const libraryDir = (botId) => path.join(dataDir, 'library', safe(botId));
fs.mkdirSync(path.join(dataDir, 'rows'), { recursive: true });

export const uid = (prefix = '') => prefix + crypto.randomBytes(6).toString('hex');
export const now = () => Date.now();
export function safe(id) { return String(id).replace(/[^\w-]/g, '_'); }

function writeFile(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function readFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ---- app state: one JSON file ----
const stateFile = path.join(dataDir, 'state.json');
const fresh = () => ({
  settings: { autoApprove: false, userName: '' },
  connections: [], // model connections
  apps: {},        // connected catalog apps: slug -> { values }
  customApps: [],  // user-made MCP servers / HTTP APIs
  bots: [], members: {}, memories: [], skills: [], routines: [], tasks: [], policies: [],
  compaction: {},
});
export const state = { ...fresh(), ...readFile(stateFile, {}) };
let timer;
export const save = () => { clearTimeout(timer); timer = setTimeout(flush, 200); };
export function flush() { clearTimeout(timer); writeFile(stateFile, state); for (const id of dirty) writeFile(rowsFile(id), cache.get(id)); dirty.clear(); }
process.on('exit', () => { try { flush(); } catch { /* shutting down */ } });

// ---- transcripts: rows (what the window shows) + llm (what the model sees), per bot ----
const rowsFile = (id) => path.join(dataDir, 'rows', `${safe(id)}.json`);
const cache = new Map();
const dirty = new Set();
export function transcript(botId) {
  if (!cache.has(botId)) cache.set(botId, readFile(rowsFile(botId), { generation: 1, nextSeq: 1, updated: 0, rows: [], llm: [] }));
  return cache.get(botId);
}
export function saveTranscript(botId) { dirty.add(botId); save(); }
export function dropTranscript(botId) { cache.delete(botId); dirty.delete(botId); fs.rmSync(rowsFile(botId), { force: true }); }
