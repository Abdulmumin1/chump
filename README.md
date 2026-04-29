# chump

> A local coding assistant for your terminal.
> TypeScript in the front, Python in the back.

`chump` is a local coding assistant built around a faster TypeScript CLI and a Python backend powered by `ai-query`.

## Quick start

For people installing `chump`:

```bash
npm install -g chump-agent
chump connect
chump
```

Requirements:

- Node.js `>=22`
- `uv` on your `PATH`

The npm package installs the `chump` binary. When `chump` needs a managed
backend, it starts `chump-server` through `uvx`.

For local development from this repository:

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
- `/sessions` — pick a saved session
- `/session <id>` — jump back into an older session directly
- `/model` — choose a connected provider and model
- `/agent <id>` — switch agent/session id directly
- `/clear` — clear stored messages for the current session
- `/new` — start a fresh session
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
- `CHUMP_PROVIDER` — `openai`, `google`, `anthropic`, or `workers_ai`
- `CHUMP_MODEL` — provider-specific default
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

### Package builds

```bash
pnpm --filter chump-agent run build
cd server && uv build
```

The CLI publishes to npm as `chump-agent` and exposes the `chump` binary. The
server publishes to PyPI as `chump-server`; the CLI uses `uvx --from
chump-server chump-server` when it is not running from a repository checkout.

### Releases

- npm releases are managed by Changesets through `.github/workflows/release.yml`
- npm publishing uses npm trusted publishing/OIDC; configure the trusted publisher on npmjs.com for `release.yml`
- PyPI publishing uses `pypa/gh-action-pypi-publish` through the same workflow's manual dispatch
- Configure PyPI trusted publishing for `chump-server`
- Python versioning is currently explicit in `server/pyproject.toml`; when we automate it, use `hatch-vcs` from git tags rather than a custom release script.

## In one sentence

`chump` is a workspace-aware terminal coding assistant that is surprisingly capable for something named `chump`.

## One last thing

If everything works on the first try, do not panic.
That is unusual, but not necessarily a sign of the apocalypse.
