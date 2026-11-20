# Krishbot handoff

For the next AI/dev. State as of 2026-11-20.

## What it is
Local-only desktop AI agent app (Windows/macOS/Linux). No cloud server, no account. Electron shell + a small Node HTTP server + one static UI. Owner: DeepuExplainsAi. Goal: one app that combines the best of agent apps (multiple bots, memory, routines, MCP/app integrations, runs on the user's own model subscriptions) completely free to run.

## History (why the code looks like this)
The repo originally held an upload `bot-hq-main.zip` (a cloud app tied to a paid cloud-computer service, Node/Hono/React, ~11k lines). It was renamed to Krishbot, then **deleted and rewritten from scratch** as a local app, because that design needed a cloud computer. Nothing from the old code remains. Do not reintroduce any cloud-computer dependency, and do not name third-party products/developers as credits in the UI/README (owner's request); the only third-party notices are in `THIRD_PARTY_NOTICES.md`.

## Layout
- `main.cjs`: Electron entry. Sets `KRISHBOT_DATA` to userData, starts the server on a random 127.0.0.1 port, opens a window.
- `src/server.js`: plain `http` server. Only accepts Host `127.0.0.1/localhost` and a per-launch token cookie. REST + SSE (`/api/chat/:botId`), config, approvals, MCP test, catalog, and the routines scheduler (30s tick). Also runnable alone: `npm run serve` (prints URL with token).
- `src/agent.js`: turn loop (max 12 steps), tool-approval flow, memory injection, `ask_bot` team tool (depth-limited to 1).
- `src/providers.js`: model calls. `openai` (any OpenAI-compatible `/chat/completions` with tools), `anthropic` (`/v1/messages` with tools), `cli` (spawns a command, prompt on stdin, text only). If the cli command starts with `claude`, the bot's MCP servers are passed via `--mcp-config` and auto-approve adds `--dangerously-skip-permissions`.
- `src/tools.js`: built-ins (`shell`, `files`, `web` = fetch + DuckDuckGo HTML search, `memory`), custom HTTP API tools, MCP client (stdio and streamable HTTP) via `@modelcontextprotocol/sdk`.
- `src/catalog.js`: one-click MCP servers run via `npx` (Playwright, filesystem, memory, sequential-thinking, GitHub, Slack, Notion).
- `src/store.js`: JSON files in the data dir (`config.json`, `chats/`, `memory/`, `routines-state.json`), mode 0600. Keys are stored in plain text locally.
- `public/index.html`: whole UI (vanilla JS, no build step): chat, settings, presets, custom API tools, MCP, catalog, routines.
- `build/icon.mjs`: generates the 512px icon PNG (no deps). `.github/workflows/release.yml`: builds AppImage/portable exe/dmg on 3 runners and publishes the `latest` release (manual `workflow_dispatch` or tag `v*`).
- `LICENSE`: custom "Krishbot License" (free use incl. commercial; no resale/redistribution/rebrand/hosting). NOT MIT, by owner's choice. `THIRD_PARTY_NOTICES.md` lists bundled/optional deps (MIT/Apache-2.0).

## Verified
- Server auth (token cookie, 401 without), chat loop with tool call against a fake OpenAI-compatible API, `cli` provider, memory file, MCP stdio connect + list tools (reference "everything" server), catalog endpoint.
- CI build succeeded and produced all three installers.

## NOT verified / known gaps
- The packaged apps were never launched (no GUI here). First thing to do: run each installer, check the window opens and a chat works.
- Anthropic provider path, Claude `--mcp-config` flow, HTTP MCP, custom API tools, routines firing, `ask_bot`, and catalog "Add" prompts are untested against real services.
- CLI providers (codex/gemini) are text-only: no tool calls; flags (`codex exec -`, `gemini -p " "`) are unchecked against current CLI versions.
- No streaming of model tokens; no image/file attachments; no voice; no full-desktop (screen) control (use the Playwright MCP for browser).
- Routines only run while the app is open; risky actions are auto-declined unless "Run actions without asking" is on.
- Mac build is arm64 only; builds are unsigned (SmartScreen/Gatekeeper warnings). No Android app (would need a separate app; local Node/MCP stdio doesn't run on Android).
- Secrets are plaintext in config.json (consider OS keychain via Electron `safeStorage`).
- Large `npx` MCP servers need Node.js installed on the user's machine; Electron's bundled Node is not on PATH.
- No tests, no auto-update.

## Ideas, by value
1. Smoke-test installers; fix whatever breaks.
2. Token streaming + stop button already aborts the request; add model-side streaming.
3. Bundle Node (or use Electron's `ELECTRON_RUN_AS_NODE`) so `npx` MCP servers work without a Node install.
4. Tool-calling for CLI providers (e.g. Codex/Gemini MCP config flags) once verified.
5. `safeStorage` for keys, Intel Mac + Linux arm builds, code signing, auto-update, Android companion.

## Dev
`npm install`, `npm start` (desktop) or `npm run serve` (browser). Release: Actions → Release → Run workflow; assets land on tag `latest`. Git identity on the cloud box was set to `DeepuExplainsAi@users.noreply.github.com`; pushing workflow files needs the `workflow` token scope.
