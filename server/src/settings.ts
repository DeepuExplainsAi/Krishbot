import { db } from './db.js';

/** App-wide settings of the one local user, kept in the database. */
db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

export function getSetting(key: string): string {
  return ((db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as any)?.value as string | undefined) ?? '';
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

export const autoApprove = () => getSetting('autoApprove') === '1';

/** Key for voice and X research: set in Settings, or XAI_API_KEY in the environment. */
export const xaiKey = () => getSetting('xaiKey') || process.env.XAI_API_KEY || '';
export const xaiModel = () => process.env.XAI_MODEL ?? 'grok-4.7';
