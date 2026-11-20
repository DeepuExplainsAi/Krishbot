# Krishbot

Your own AI Bots, running on your own computer. Free for personal and commercial use.

- Chat with Bots that run commands, read and write files, browse the web and use your apps.
- Use the AI you already have: a Claude, ChatGPT or Gemini plan through its command-line app, a free local model (Ollama, LM Studio), a free-tier key, or any OpenAI-compatible API.
- Connect apps with one click, or add your own MCP server or web API.
- Skills, memories, routines (they run while Krishbot is open), tasks, group chats, a Library folder for files the Bots make.
- Everything stays on this computer. Nothing to host and no account to create.

## Download

Get the installer for your system from the [latest release](../../releases/latest): Windows (`.exe`), macOS (`.dmg`), Linux (`.AppImage`).
The apps are not code-signed. Windows: "More info" then "Run anyway". macOS: right-click, Open. Linux: `chmod +x` the file, then run it.

## Run from source

```
npm install
npm run build
npm start        # desktop window
npm run serve    # or just the local server, prints a link
```

Node.js 20+ is needed. One-click apps start with `npx`, so they need Node.js installed too.

## License

See [LICENSE](LICENSE). The license is also shown in Settings → About.
