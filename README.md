# Krishbot

Your own AI Bots, running on your own computer. Free for personal and commercial use.

- Chat with Bots that run commands, read and write files, browse the web and use your apps.
- Use the AI you already have: a subscription through its command-line app, a free local model, a free-tier key, or any compatible API. Sign in from the Engine panel.
- Connect apps with one click, or add your own MCP server or web API.
- Skills, memories, routines (they run while Krishbot is open), tasks, group chats, a Library folder for files the Bots make.
- Everything stays on this computer. Nothing to host and no account to create.

## Install

Needs Node.js 20 or newer (`node -v` to check).

**Easiest: download the code, then start it**

- Windows: double-click `start.bat`. It installs, builds, starts and opens the browser. (Works even when PowerShell blocks scripts.)
- macOS / Linux: run `./start.sh`.

Or by hand, one line at a time:

**Windows (PowerShell)**

```
git clone https://github.com/DeepuExplainsAi/Krishbot
cd Krishbot
npm.cmd install
npm.cmd run build
npm.cmd run serve
```

(PowerShell 5 does not understand `&&`, and plain `npm` fails with "running scripts is disabled"; `npm.cmd` avoids that. Type `npm.cmd`, not `npm`.)

**macOS / Linux**

```
git clone https://github.com/DeepuExplainsAi/Krishbot && cd Krishbot && npm install && npm run build && npm run serve
```

Then open the `http://localhost:8787` link it prints.

**With a coding agent** (Claude Code, Codex, Cursor, VS Code ...): paste this.

```
Install and run Krishbot on this computer.
Repo: https://github.com/DeepuExplainsAi/Krishbot
1. Check Node.js 20+ (node -v); install it if missing.
2. git clone the repo and cd Krishbot.
3. Run npm install, npm run build, npm run serve, one at a time (no && on Windows PowerShell 5; use npm.cmd if scripts are blocked).
4. Keep the server running and open the printed http://localhost:8787 link.
5. If a step fails, fix the cause and retry, then tell me what you did.
Do not change the licence or author name.
```

Bots need the Hermes agent plus a model key or subscription to answer. Desktop installers are on the [releases page](../../releases/latest) but are not tested on Windows; the commands above are the tested route.

## Give the main agent the app tools

Start Krishbot once, then run `python3 scripts/add-hq-to-hermes.py`. It adds one `hq` entry to `~/.hermes/config.yaml` and keeps a backup copy.

## Run from source

```
npm install
npm run build
npm start        # desktop window (rebuilds the database module for it)
npm run serve    # or just the local server (run `npm rebuild better-sqlite3` first if you ran npm start before)
```

Node.js 20+ is needed. One-click apps start with `npx`, so they need Node.js installed too.

## License

Copyright (c) 2026 DeepuExplainsAi. Licensed under the [GNU AGPL v3.0](LICENSE). The license is also shown in Settings → About.
