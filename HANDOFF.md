# Krishbot handoff

State as of 2026-11-20. Owner: DeepuExplainsAi.

## What it is
Local-only desktop AI app (Windows/macOS/Linux). No cloud, no account. Electron shell + a small Node `http` server + the React UI (`web/`). The UI is the original design, restored on purpose: the owner wants it pixel-identical (sidebar, avatars, folded "Worked for…" steps, bot settings, Tasks, Library, app settings). **Do not redesign it.** Only the cloud-bound parts were removed.

## History
Old code (cloud-computer based) is in git at `870fbcd`. `f4e567e` replaced it with a simple UI; the owner rejected that, so the original React UI was restored over the new local backend.

## Layout
- `main.cjs`: Electron entry; starts the server on a random 127.0.0.1 port, opens a window.
- `src/server.js`: REST + SSE (`/api/events`) implementing the contract the UI expects (`web/src/lib/api.ts`, `configApi.ts`). Host check + per-launch token cookie. Serves `web/dist`.
- `src/agent.js`: turn loop (step cap by bot `effort`), rows (message/tool-call/card/notice), approvals, `ask_user` question cards, memory/tasks/routines tools, `ask_bot`, group chats, history compaction, routines tick.
- `src/providers.js`: `openai` (any compatible API), `anthropic`, `cli` (Claude/Codex/Gemini or any command; prompt on stdin, text only; Claude gets MCP via `--mcp-config`).
- `src/presets.js`: model presets shown in Settings → Models.
- `src/tools.js`: built-in tools, custom web-API tools, MCP client (stdio + streamable HTTP).
- `src/catalog.js`: one-click apps (MCP servers via `npx`); fields = keys the user fills in.
- `src/store.js`: `state.json` + `rows/<bot>.json` in the data dir; Library files in `library/<bot>/`.
- `src/routines.js`: 5-field cron + "every N min/hours".
- `web/`: React 18 + Vite + zustand. `shared/`: types used by `@shared` alias.
- `.github/workflows/release.yml`: builds AppImage / portable exe / dmg and publishes tag `latest`.
- `LICENSE` (custom Krishbot License, not MIT), `THIRD_PARTY_NOTICES.md`. License also shown in Settings → About.

## Removed (cloud-bound)
Cloud computer viewer/noVNC, computer sleep/wake, Google sign-in (UI always signed in as "You"), Hermes engine panel (replaced by a local provider/model picker), voice chat and dictation (needed a cloud voice service), OAuth app connect (replaced by key forms + custom MCP/web API). "Share" is a stub toast.

## Verified (this session)
`tsc` clean, `vite build` OK, server + UI in headless Chromium: chat → approval card → tool run → reply, Models page, Connect Apps, Details panel, stdio MCP connect (reference "everything" server), cron next-run math. Fake OpenAI server used for the model.

## NOT verified
- Packaged installers were never launched.
- Real model services (Anthropic, Groq, etc.), Claude/Codex/Gemini CLI flags, HTTP MCP, catalog apps with real keys, routines actually firing, group chats, `ask_bot`, bot-settings skills/memories UI against live data.
- CLI providers don't get Krishbot's own tools (memory, tasks, routines, ask_user); they use their own.
- No token streaming. No attachments. Routines run only while the app is open.
- Mac is arm64 only; builds are unsigned. No Android.
- Keys are plaintext in `state.json` (consider Electron `safeStorage`).
- `npx` apps need Node.js installed on the user's machine.
- Library download links are plain GETs with the cookie; check in the packaged app.

## Dev
`npm install && npm run build && npm run serve` (prints URL with token), or `npm start` for Electron. UI dev: `cd web && npm run dev` (proxies `/api` to :8787; needs the token cookie from the printed URL). Release: Actions → Release → Run workflow. The VM used so far has 482MB RAM: builds and Chromium need swap.

## OWNER'S RULE (latest, overrides everything above)
Keep **everything from the old app** (commit `870fbcd`, `server/src` ~281 KB): UI AND backend, including the Hermes agent harness, sub-agents, rooms, proactive/triggers, routines, memory/engine-memory, MCP, desk, config routes, voice, skills, library, etc. Remove ONLY:
1. the cloud server parts (hosted server, Orgo cloud computer, Google/hosted auth, hosted-only services). Their jobs must run on the user's own computer instead;
2. the names of other developers/companies (README, UI text, docs, licenses of ours).
Everything must still work free, locally, on the user's own subscriptions/keys.

## Status of that rule
DONE on branch `full-port` (see below). The old `server/src` TypeScript app is back, made local-only.

- Removed cloud parts: `orgo.ts`, `vnc.ts`, `composio.ts`, `idle.ts`, `desk.ts`, `computer.ts`, Google/hosted auth, screen/viewer UI, `server/box`.
- Replaced with local: `env.ts` (data dir `~/.krishbot`), `lib/auth.ts` (single local user, 127.0.0.1 + same-origin checks), `apps.ts` (npx MCP catalog + custom MCP/web API apps, keys in the local DB), `triggers.ts` (webhook event routines at `/hooks/<secret>`), `terminal.ts` (model sign-in in a terminal window), `settings.ts` (voice/research key, auto-approve).
- Kept: Hermes harness (`engine.ts`), sub-agents, rooms, proactive, routines, memory, MCP, config routes, voice, skills, library, old Composer and Engine panel.
- Names of other developers/companies removed from README, SECURITY, ARCHITECTURE, UI text. Left on purpose: the MIT notices in `THIRD_PARTY_NOTICES.md` (the licenses require them), the `hermes` CLI name, internal voice API identifiers, and `XAI_*` env names.
- Dark mode: black bot avatar now `--color-avatar-black` (grey in dark), `--color-border` defined, `color-scheme` set per theme (native selects/scrollbars), select options, draft-card and toolkit logo colors fixed. Found by static audit; no screenshots were possible on the 482 MB VM, so check once by eye.
- Packaging: root `package.json` holds server + Electron deps; `main.cjs` starts the compiled server on a free local port and opens a window. `npmRebuild` rebuilds `better-sqlite3` for Electron in `npm run dist`.

## Still unverified (needs a real machine)
Installers from the release workflow, real Hermes sign-in per provider, voice with a real key, group chats against a live agent, npx apps (need Node.js), the dark mode look.
