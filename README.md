# chump

`chump` is a local coding assistant scaffold built around a fast TypeScript CLI
and a Python backend powered by `ai-query`.

## Workspace Layout

- `client/`: TypeScript CLI package
- `server/`: Python backend package
- `ai-query/`: local reference clone of the framework, ignored by this repo
- `.plans/`: local planning notes, ignored by this repo

## Development

The scaffold assumes local development with `uv` and Node.js.

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
npm install
npm run dev
```

## Current Status

This is an initial scaffold. The server and CLI are intentionally minimal but
named and structured for the first implementation pass.

