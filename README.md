# chump

> A local coding assistant for your terminal.  
> TypeScript in the front, Python in the back, and just enough chaos to stay interesting.

`chump` is a local coding assistant built around a fast TypeScript CLI and a Python backend powered by `ai-query`.
It starts or reuses one local server per workspace, keeps session history around, streams tool activity live, and helps with software tasks without pretending it definitely knows what your build system is doing today.

## Quick start

```bash
pnpm install
cd server && uv sync
cd ../client && pnpm run bin:install
chump
```

What `chump` does after that:

1. Finds your workspace root by walking up to the nearest `.git`
2. Starts or reuses a local server for that workspace
3. Opens the interactive CLI
4. Waits for your instructions
5. Politely rummages through your repo like a licensed raccoon

## CLI commands

```bash
chump
```

Starts the interactive CLI and auto-starts a managed local server when needed.

```bash
chump client
```

Starts the interactive CLI without auto-starting a server. Useful when the server already exists and you want to live dangerously, but in a very specific way.

```bash
chump -c http://127.0.0.1:8080
```

Connects to an existing server and never auto-starts a managed one.

```bash
chump server
```

Runs the backend in the foreground for debugging.

```bash
chump status
```

Shows server health, managed server metadata, and current session status.

```bash
chump stop
```

Stops the managed local server for the current workspace.

## Interactive slash commands

- `/help` — show available commands
- `/status` — show current agent and server status
- `/state` — inspect session state
- `/messages` — show stored messages for the current session
- `/sessions` — list saved sessions
- `/session` — show the current session id
- `/session new` — start a fresh session
- `/session <id>` — jump back into an older session
- `/agent <id>` — switch agent/session id directly
- `/clear` — clear stored messages for the current session
- `/events on|off` — toggle tool and step event rendering
- `/quit` — leave the chat and return to the loving embrace of your shell

## Local files chump creates

Inside your workspace, `chump` keeps its local state in:

```text
.chump/
├── chump.sqlite3   # session history and event log
├── server.json     # managed server metadata
└── server.log      # backend logs
```

So yes, it keeps receipts.

## Server routes

If you want to script against the backend or just poke it with `curl` because that feels powerful:

- `GET /health` — server health, config, versions, uptime, active session count
- `GET /version` — Chump and `ai-query` versions
- `GET /sessions` — stored session summaries
- `GET /agent/{id}/messages` — stored messages for one session
- `GET /agent/{id}/state` — current state for one session
- `POST /agent/{id}/chat?stream=true` — streaming chat
- `GET /agent/{id}/events` — session event stream

## Useful environment variables

### Client

- `CHUMP_SERVER_URL` — connect to an existing server
- `CHUMP_SESSION_ID` — force a specific session id
- `CHUMP_AGENT_ID` — alias for session id

### Server

- `CHUMP_HOST` — default `127.0.0.1`
- `CHUMP_PORT` — default `8080` when set manually, random free port when auto-managed
- `CHUMP_WORKSPACE_ROOT` — workspace root override
- `CHUMP_DATA_DIR` — where `.chump` data lives
- `CHUMP_PROVIDER` — `openai`, `google`, or `anthropic`
- `CHUMP_MODEL` — default `gpt-5.4`
- `CHUMP_MAX_STEPS` — default `64`
- `CHUMP_COMMAND_TIMEOUT` — default `120`
- `CHUMP_REASONING_EFFORT` — one of `none|minimal|low|medium|high|xhigh`
- `CHUMP_REASONING_BUDGET` — optional reasoning budget
- `CHUMP_VERBOSE` — default `1`

## Workspace layout

- `client/` — the TypeScript CLI package
- `server/` — the Python backend package
- `ai-query/` — local editable source for the agent framework during development
- `.plans/` — local planning notes

## Development

### Run the backend directly

```bash
cd server
uv sync
uv run chump-server
```

### Run checks

```bash
pnpm typecheck
pnpm smoke
```

### Local binary testing

```bash
cd client
pnpm run bin:install
chump
```

## In one sentence

`chump` is a workspace-aware terminal coding assistant that is surprisingly capable for something named `chump`.

## One last thing

If everything works on the first try, do not panic.
That is unusual, but not necessarily a sign of the apocalypse.
