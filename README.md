# Krishbot

Your own AI Bots, running on your own computer. Free for personal and commercial use.

- Chat with Bots that run commands, read and write files, browse the web and use your apps.
- Use the AI you already have: a subscription through its command-line app, a free local model, a free-tier key, or any compatible API. Sign in from the Engine panel.
- Connect apps with one click, or add your own MCP server or web API.
- Skills, memories, routines (they run while Krishbot is open), tasks, group chats, a Library folder for files the Bots make.
- Everything stays on this computer. Nothing to host and no account to create.

## Requirements

| Needed | Version |
|---|---|
| Node.js | **22.13 or newer** (24 LTS recommended; 20 and older do not work) |
| npm | Comes with Node.js |
| Git | Optional (you can download the zip instead) |
| System | Windows 10/11, macOS or Linux |
| Disk and RAM | About 1 GB free disk for the install. 2 GB RAM or more is comfortable. |
| Internet | For the first install, and for the AI model you use |

Not needed: Python, Visual Studio build tools or any compiler.
Bots answer only with the Hermes agent plus a model key or subscription.

## Install

Install **Node.js 22.13 or newer** from [nodejs.org](https://nodejs.org) (pick LTS) and check it with `node -v`.

### 1. Get the code

Download the zip from the green **Code** button and unzip it, or run `git clone https://github.com/DeepuExplainsAi/Krishbot`.

### 2. Start it

- **Windows:** open the Krishbot folder and double-click `start.bat`. If Windows says "protected your PC", click More info, then Run anyway.
- **macOS / Linux:** in the folder, run `./start.sh`.

The first start installs and builds (a few minutes), then opens `http://localhost:8787`. Later starts are fast.

### By hand (Windows PowerShell)

Type each line separately. Use `npm.cmd`, not `npm` (PowerShell blocks `npm` with "running scripts is disabled").

```
cd Krishbot
npm.cmd install
npm.cmd run build
npm.cmd run serve
```

### By hand (macOS / Linux / Git Bash / cmd)

```
cd Krishbot
npm install
npm run build
npm run serve
```

### Problems

| Message | Fix |
|---|---|
| `running scripts is disabled on this system` | Use `start.bat`, or type `npm.cmd` instead of `npm`. |
| `&&` is not a valid statement separator | Run one command per line. |
| `Node.js ... too old` or `node:sqlite` not found | Install Node.js 22.13 or newer. |
| Port 8787 in use | Close the other Krishbot window, or set `PORT=8788`. |

### With a coding agent

Paste into Claude Code, Codex, Cursor or VS Code:

```
Install and run Krishbot on this computer. Repo: https://github.com/DeepuExplainsAi/Krishbot
1. Check Node.js 22.13+ (node -v); install it if missing.
2. git clone the repo and cd Krishbot.
3. On Windows run start.bat; on macOS/Linux run ./start.sh. (By hand: npm install, npm run build, npm run serve, one at a time. On Windows PowerShell use npm.cmd.)
4. Keep the server running and open http://localhost:8787.
5. If a step fails, fix the cause and retry, then tell me what you did.
Do not change the licence or author name.
```

Bots need the Hermes agent plus a model key or subscription to answer. Desktop installers on the [releases page](../../releases/latest) are not tested on Windows; `start.bat` is the tested route.

## Give the main agent the app tools

Start Krishbot once, then run `python3 scripts/add-hq-to-hermes.py`. It adds one `hq` entry to `~/.hermes/config.yaml` and keeps a backup copy.

## Run from source

```
npm install
npm run build
npm start        # desktop window
npm run serve    # or just the local server
```

Node.js 22.13+ is needed. One-click apps start with `npx`, so they need Node.js installed too.

## License

Copyright (c) 2026 DeepuExplainsAi. Licensed under the [GNU AGPL v3.0](LICENSE). The license is also shown in Settings → About.
