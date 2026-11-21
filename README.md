# Krishbot

Your own AI Bots, running on your own computer. Free for personal and commercial use.

- Chat with Bots that run commands, read and write files, browse the web and use your apps.
- Use the AI you already have: a subscription through its command-line app, a free local model, a free-tier key, or any compatible API. Sign in from the Engine panel.
- Connect apps with one click, or add your own MCP server or web API.
- Skills, memories, routines (they run while Krishbot is open), tasks, group chats, a Library folder for files the Bots make.
- Everything stays on this computer. Nothing to host and no account to create.

## Download

Get the installer for your system from the [latest release](../../releases/latest): Windows (`.exe`), macOS (`.dmg`), Linux (`.AppImage`).
The apps are not code-signed. Windows: "More info" then "Run anyway". macOS: right-click, Open. Linux: `chmod +x` the file, then run it.

**Installer not working?** Use the terminal route (needs Node.js 20+), it is the tested one:

```
git clone https://github.com/DeepuExplainsAi/Krishbot
cd Krishbot
npm install
npm run build
npm run serve
```

Run the lines one at a time (Windows PowerShell 5 does not understand `&&`).

Then open the `http://localhost:8787` link it prints.

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
