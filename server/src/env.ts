import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Everything the app keeps (database, agent homes, library files, secret) lives in one folder on this computer. */
const dataDir = process.env.KRISHBOT_DATA || path.join(os.homedir(), '.krishbot');
fs.mkdirSync(dataDir, { recursive: true });

/** Signs the agents' /mcp tokens. Made once and kept next to the data. */
function sessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const port = Number(process.env.PORT ?? 8787);
const hermesHome = process.env.HERMES_HOME_PRIMARY ?? path.join(os.homedir(), '.hermes');

export const env = {
  dataDir,
  port,
  /** Only this computer may reach the app. */
  host: process.env.HOST || '127.0.0.1',
  appUrl: process.env.APP_URL ?? `http://127.0.0.1:${port}`,
  sessionSecret: sessionSecret(),
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'krishbot.db'),

  // ---- the agent engine ----
  hermesBin: process.env.HERMES_BIN ?? 'hermes',
  /** The primary bot's agent home and API server (an agent that already runs; never restarted by us). */
  hermesHome,
  hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
  hermesKey: process.env.HERMES_KEY ?? '',
  /** Where each extra bot's own agent home lives. Must be outside ~/.hermes so it is a separate tenant. */
  enginesDir: process.env.ENGINES_DIR ?? path.join(dataDir, 'engines'),
  enginePortBase: Number(process.env.ENGINE_PORT_BASE ?? 8650),
  /** URL the agents use to reach this app's MCP endpoint. */
  mcpBaseUrl: (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  extraMcpServers: process.env.EXTRA_MCP_SERVERS ?? '',
  primaryBotName: process.env.PRIMARY_BOT_NAME ?? 'Krish',
  primaryBotLabel: process.env.PRIMARY_BOT_LABEL ?? 'Chief of Staff',
  maxBots: Number(process.env.MAX_BOTS ?? 50),
};

/** KRISHBOT_<name> from the environment. */
export function compatEnv(name: string): string | undefined {
  return process.env[`KRISHBOT_${name}`];
}
