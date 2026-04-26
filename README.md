# chump

`chump` is a local coding assistant built around a fast TypeScript CLI and a
Python backend powered by `ai-query`.

## Commands

```bash
chump
```

Starts or reuses one managed local server for the current workspace, then opens
the interactive CLI.

```bash
chump -c http://127.0.0.1:8080
```

Connects to an existing server and never auto-starts a managed server.

```bash
chump server
```

Runs the backend in the foreground for debugging.

```bash
chump status
```

Shows managed server metadata, server health, and current session status.

```bash
chump stop
```

Stops the managed local server for the current workspace.

## Interactive Commands

- `/help`: show available commands
- `/status`: show server health and current session status
- `/state`: show current session state
- `/messages`: show stored messages for the current session
- `/sessions`: list stored sessions
- `/session`: show the current session id
- `/session new`: start a fresh session
- `/session <id>`: switch to a stored session
- `/clear`: clear current session messages
- `/events on|off`: toggle tool and step event rendering
- `/quit`: exit the CLI

## Server Routes

- `GET /health`: server health, versions, config, active session count
- `GET /version`: Chump and `ai-query` versions
- `GET /sessions`: stored session summaries
- `GET /agent/{id}/messages`: stored messages for one session
- `GET /agent/{id}/state`: state for one active session
- `POST /agent/{id}/chat?stream=true`: streaming chat
- `GET /agent/{id}/events`: session event stream

## Workspace Layout

- `client/`: TypeScript CLI package
- `server/`: Python backend package
- `ai-query/`: local reference clone of the framework, ignored by this repo
- `.plans/`: local planning notes, ignored by this repo

## Development

The scaffold assumes local development with `uv`, Node.js, and `pnpm`.

### Python backend

The backend uses a local editable source for `ai-query` during development:

```bash
cd server
uv sync
uv run chump-server
```

### CLI

```bash
pnpm install
pnpm typecheck
pnpm smoke
```

For local binary testing:

```bash
cd client
pnpm run bin:install
chump
```
