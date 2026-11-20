# Krishbot

AI agents that run on your own computer. No cloud server, no account, nothing to host. Windows, macOS, Linux.

## Download
Get the file for your system from the [latest release](../../releases/latest):
- Windows: `Krishbot-…-windows-x64.exe` (double-click)
- macOS: `Krishbot-…-mac-….dmg`
- Linux: `Krishbot-…-linux-x64.AppImage` (`chmod +x`, then run)

Builds are unsigned: Windows SmartScreen ("More info → Run anyway") and macOS (right-click → Open) warn once.

## What it does
- **Your model, your choice** (Settings → Model connections):
  - Local and free: Ollama, LM Studio.
  - Free tiers: Groq, OpenRouter free models, Google Gemini.
  - Paid keys: OpenAI, Anthropic.
  - Any OpenAI-compatible URL.
  - Your existing subscription: runs your signed-in CLI (Claude Code, Codex, Gemini CLI, or any command) so usage counts on your plan.
- **Several bots**, each with its own instructions, model and tools.
- **Tools:** run commands, read/write files, web search and fetch, and your own:
  - **Custom API tools:** describe any HTTP API (URL, headers, body with `{placeholders}`).
  - **MCP servers:** any stdio command or HTTP URL.
- Actions that change things (commands, writes, POST/PUT/DELETE) ask for your OK; this can be turned off.
- Everything is stored in your user folder. Keys never leave your computer except to the model API you chose.

CLI connections return text only (no tool calls); use an API connection for tools.

## Develop
```
npm install
npm start          # desktop app
npm run serve      # same UI in a browser, URL printed in the console
```
Releases: GitHub Actions → "Release" builds all three systems and updates the `latest` release.

## License
Krishbot License (free to use, no resale or redistribution), Copyright (c) 2026 Krishbot, DeepuExplainsAi. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
