# Architecture

A web app (`web/`) and a Node server (`server/`) run on your computer, in front of Hermes agents. Hermes owns each Bot's agent loop, history, memory and model. The server adds the chat interface, apps, routines, tasks, group chats, the Library and voice. Everything is local; there is one user and no sign-in.

```text
window / browser ── HTTP + SSE ──► server ── POST /v1/responses ──► Hermes gateway (one per Bot)
                                     ▲                                  │
                                     └────────── MCP: POST /mcp/<bot> ──┘
```

## Components

| Piece | Where | What it does |
|---|---|---|
| API + realtime | `server/src/routes*.ts`, `lib/hub.ts` | JSON over HTTP and one Server-Sent Events stream (`GET /api/events`) with row updates, live state and roster changes |
| Local user | `lib/auth.ts`, `env.ts` | One user, created on first start. `GET /api/auth/me` sets the session cookie. Only 127.0.0.1 hosts and same-origin writes are accepted |
| Turns | `agent/loop.ts` | Per-Bot serial queue. A turn posts to the Bot's gateway (`/v1/responses`, streaming) and turns events into rows and live state |
| Engines | `engine.ts` | The **primary** engine is the gateway on `HERMES_URL`. A **managed** engine is a Hermes home under `ENGINES_DIR/<botId>` with its own `hermes gateway run` on port 8650+. Model sign-in opens a terminal window (`terminal.ts`) |
| App tools | `mcp.ts`, `agent/tools.ts` | MCP endpoint per Bot (`/mcp/<botId>`, `/mcp/primary`), bearer token derived from the local secret. Tools: `x_search`, `save_file`, routines, tasks, check-ins, `send_to_bot`, group chats, `ask_user`, apps |
| Apps | `apps.ts` | Local catalog of MCP servers started with `npx`, plus your own MCP server or web API. Keys are stored in the local database. Tools are named `<app>__<action>` |
| Event routines | `triggers.ts` | A routine on `event:<secret>` runs when `POST /hooks/<secret>` is called |
| Scheduling | `routines.ts`, `proactive.ts` | Cron routines (they run while the app is open) and check-ins for the primary Bot |
| Memory | `engine-memory.ts` | Entries in each Hermes home (`memories/MEMORY.md`, `USER.md`) |
| Library | `paths.ts`, `routes-config.ts` | Files the Bots make, under `<KRISHBOT_DATA>/files` |
| Voice | `voice.ts`, `web/src/voice/*` | Realtime voice, speech previews and dictation, with the key from Settings |
| UI | `web/src` | React + zustand: sidebar, chat, details panel, settings, voice call bar |
| Desktop | `main.cjs` | Electron window around the local server |

## Transcript model

A conversation is an append-mostly list of **rows**: `seq`, `updatedSeq`, `kind` and a JSON `body`. A streaming reply is the same row rewritten with a higher `updatedSeq`, so clients upsert by `seq`. A per-Bot `generation` is bumped when the chat is cleared.

Row kinds: `message`, `tool-call`, `card` (approval, question, connect, draft), `event`, `notice`. The model's own history belongs to Hermes.

## Approvals

Approvals happen inside the MCP call, so they work the same for every engine. Read-only app tools run at once; anything else posts an approval card and waits. **Allow** runs once, **Always allow** stores a per-tool policy, **Don't allow** returns a refusal. A new user message, or no answer in time, closes the card.

## Bots working together

- `send_to_bot` delivers a message to another Bot's queue.
- Group chats are a Bot row with `kind='room'` and a member list; a message goes to the @mentioned members or to all (up to 3).
- Subagents are hidden child Bots that report back with `send_to_bot`.

## Data

Everything is under `KRISHBOT_DATA` (default `~/.krishbot`): the SQLite database, the secret file, `files/` (Library) and `engines/` (Hermes homes).
