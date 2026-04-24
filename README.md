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

The backend uses a local editable source for `ai-query` during development
