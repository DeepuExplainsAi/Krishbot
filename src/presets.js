import { execFileSync } from 'node:child_process';

// Ways to connect a model. `bin` = the command-line tool a subscription uses.
export const PRESETS = [
  { id: 'claude-cli', group: 'Your subscription', label: 'Claude (Pro/Max plan, via Claude Code)', type: 'cli', command: 'claude -p', bin: 'claude', hint: 'Install Claude Code and run `claude` once to sign in. It works with your own plan.' },
  { id: 'codex-cli', group: 'Your subscription', label: 'ChatGPT (Plus/Pro plan, via Codex)', type: 'cli', command: 'codex exec --skip-git-repo-check -', bin: 'codex', hint: 'Install Codex CLI and run `codex` once to sign in with ChatGPT.' },
  { id: 'gemini-cli', group: 'Your subscription', label: 'Gemini (Google account, via Gemini CLI)', type: 'cli', command: 'gemini -p " "', bin: 'gemini', hint: 'Install Gemini CLI and run `gemini` once to sign in with Google (has a free tier).' },
  { id: 'custom-cli', group: 'Your subscription', label: 'Any command (prompt goes to stdin)', type: 'cli', command: '', hint: 'Any program that reads a prompt on stdin and prints the answer.' },
  { id: 'ollama', group: 'On this computer, free', label: 'Ollama', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', models: ['llama3.1', 'qwen2.5', 'mistral'], hint: 'Install Ollama and run `ollama pull llama3.1`.' },
  { id: 'lmstudio', group: 'On this computer, free', label: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', models: [] },
  { id: 'groq', group: 'Free tiers', label: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], needsKey: true, hint: 'Free key at console.groq.com/keys' },
  { id: 'openrouter', group: 'Free tiers', label: 'OpenRouter (free models)', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', models: ['meta-llama/llama-3.3-70b-instruct:free'], needsKey: true, hint: 'Free key at openrouter.ai/keys' },
  { id: 'gemini', group: 'Free tiers', label: 'Google Gemini API', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-1.5-flash'], needsKey: true, hint: 'Free key at aistudio.google.com/apikey' },
  { id: 'openai', group: 'API keys', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o'], needsKey: true },
  { id: 'anthropic', group: 'API keys', label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], needsKey: true },
  { id: 'custom', group: 'API keys', label: 'Any OpenAI-compatible API', type: 'openai', baseUrl: '', model: '', models: [], needsKey: true },
];

export function binFound(bin) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
}
export const presetsWithStatus = () => PRESETS.map((p) => ({ ...p, found: p.bin ? binFound(p.bin) : undefined }));
