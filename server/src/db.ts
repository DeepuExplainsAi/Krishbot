import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
/** Node's built-in SQLite (no native module to compile), with the two helpers the rest of the server uses. */
/** better-sqlite3 accepted undefined and booleans; node:sqlite does not. */
const bind = (a: unknown[]) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

class Db extends DatabaseSync {
  prepare(sql: string): any {
    const st = super.prepare(sql);
    const run = st.run.bind(st), get = st.get.bind(st), all = st.all.bind(st);
    st.run = (...a: any[]) => run(...(bind(a) as any[]));
    st.get = (...a: any[]) => get(...(bind(a) as any[]));
    st.all = (...a: any[]) => all(...(bind(a) as any[]));
    return st;
  }
  pragma(sql: string) { this.exec(`PRAGMA ${sql}`); }
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.exec('BEGIN IMMEDIATE');
      try { const r = fn(); this.exec('COMMIT'); return r; } catch (e) { this.exec('ROLLBACK'); throw e; }
    };
  }
}

export const db = new Db(env.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  avatar_shape TEXT NOT NULL DEFAULT 'blob',
  avatar_color TEXT NOT NULL DEFAULT 'blue',
  mode TEXT NOT NULL DEFAULT 'personal',
  is_primary INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  effort TEXT NOT NULL DEFAULT 'medium',
  generation INTEGER NOT NULL DEFAULT 1,
  next_seq INTEGER NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rows (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, generation, seq)
);
CREATE INDEX IF NOT EXISTS rows_rev ON rows(bot_id, updated_seq);
CREATE TABLE IF NOT EXISTS llm_items (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (bot_id, generation, idx)
);
CREATE TABLE IF NOT EXISTS pending_turns (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  row_seq INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS policies (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  mode TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'working',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Idempotent column migrations for tables that predate a column.
function addColumn(table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addColumn('bots', 'voice', "TEXT NOT NULL DEFAULT 'luna'");
addColumn('bots', 'voice_speed', 'REAL NOT NULL DEFAULT 1');
addColumn('bots', 'voice_language', "TEXT NOT NULL DEFAULT 'auto'");
// Hermes engine: per-bot model choice, which engine runs the bot ('primary' = the existing agent,
// 'managed' = a gateway we start), and the managed gateway's port.
addColumn('bots', 'model', 'TEXT');
addColumn('bots', 'provider', 'TEXT');
addColumn('bots', 'engine', 'TEXT');
addColumn('bots', 'engine_port', 'INTEGER');
addColumn('bots', 'handback_at', 'INTEGER');

export const now = () => Date.now();
