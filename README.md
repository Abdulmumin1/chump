# chump

`chump` is a local coding assistant built around a fast TypeScript CLI and a
Python backend powered by `ai-query`.

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

### TypeScript CLI

The CLI uses Node 22's built-in type stripping for local execution:

```bash
cd client
pnpm install
pnpm run dev
```

## CLI Install

For local machine install during development:

```bash
pnpm install
pnpm --dir client run bin:install
```

That exposes the `chump` binary globally through `pnpm link`.

## Project Process

- CI runs on GitHub Actions for both the client and server.
- Client checks use `pnpm`.
- Server checks use `uv`.
- Release tracking uses Changesets.
- Create a release note entry with `pnpm changeset`.
- Version packages with `pnpm version-packages`.
- Publish with `pnpm release`.

## Current Status

The project now has the first real integration pass in place:

- the CLI can stream chat responses from the backend
- `/status`, `/state`, and `/clear` call backend routes
- `/events on` opens the backend SSE stream for agent events
- the backend exposes safe filesystem and shell tools to `ChumpAgent`
