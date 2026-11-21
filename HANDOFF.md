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

## NEXT WORK (owner's list, 2026-11-21; not started, do in this order)
Owner's screenshots come from the OLD release build (`src/*.js` rewrite), so first re-check each item on the new `full-port` build, fix what still fails, then merge to `main`.

1. **Model setup errors ("Not found").** OpenRouter (`https://openrouter.ai/api/v1`, free models) shows red "Not found" on Save and test, and Gemini CLI cannot be added. Show the real provider error, never a bare "Not found". The Gemini CLI turn failed with exit 55: "Gemini CLI is not running in a trusted folder"; run it with `--skip-trust` (or set `GEMINI_CLI_TRUST_WORKSPACE=true`) and a trusted working dir. Check this on the new Hermes-based Engine panel too.
2. **Live model lists everywhere.** Every model picker (Engine panel, any "Manage models") must fetch the list live from the provider (`/models`, Hermes `GET /api/model/options`) and mark which are free. Add a refresh button next to each list so models that appear later show up. The Model field must be a dropdown of the live list (typed value allowed), not a bare text box with "default". Same rule for MCP/app lists.
3. **No cloud computer.** The old zip had a "Computer" view on the side that ran on a cloud server. It must not exist; everything runs on the user's own PC. Check that no panel, button or text still mentions it.
4. **Automatic bot creation and delegation (lost feature).** In the zip, the main bot created new bots by itself and gave them work (as in the original Grok bot). Verify tools `create_bot`, `send_to_bot`, subagents and rooms in `agent/tools.ts`, `agent/subagents.ts` and `agent/prompt.ts` still work end to end and that the prompt tells the main bot to do this on its own. Compare with `~/bot/bot-hq-main` (zip) and with commit `870fbcd`; restore anything missing except cloud parts.
5. **Other lost features from the zip.** Reference: the owner built the zip from the video "I Stole the Best Part of Every AI Agent... With One Prompt (Open Source)" by Nick Vasilescu (https://youtu.be/ceU0tS6sXbU; channel @nickvasiles). Its page text is not readable from the VM; open it in a browser, list the features shown, and check each exists. Keep everything local, remove only cloud parts. Still not ported: `tests/e2e.mjs`, `tests/voice-call.mjs`, `web/src/dev/fixtures.ts` (they target the old cloud API).
6. **Dark mode (still broken on the owner's laptop, see screenshots).**
   - Connect Apps: app/tool logo tiles are solid light squares with no icon; "Save", "Connect" and the token input overlap other rows (layout overlaps, tooltip over rows).
   - A MCP/API "personal access token" field floats over the Notion row.
   - Bot templates popup and the Engine panel text are very dim; the Model field text is almost invisible.
   - The app logo is missing in the window and taskbar (`build/icon.png` is generated only in `npm run dist`; make sure a real logo ships and the window uses it).
   - Test on a real dark-mode screen with screenshots (the 482 MB VM cannot run Chromium).
7. **Templates.** The bot-template button and its popup do not work well (cursor on "Bot templa…", popup mostly empty).
8. **MCP / app tokens.** Pasting a token for an app (GitHub, Notion, Slack) must be a clean inline form with a visible field, Save and Test, and clear errors.
9. **Installer vs command.** Owner wants whichever works. Today `npm install && npm run build && npm run serve` (open the printed localhost link) is tested; the Electron installer from the release page is NOT tested. Verify the installer on Windows (the owner uses Windows 11); if it fails, remove the release workflow's installers and ship the one-line terminal command instead (document it in README).
10. After all of the above: update this file (done / not done), then merge `full-port` into `main`.
