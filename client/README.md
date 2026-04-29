# chump-agent

TypeScript CLI package for `chump`.

## Requirements

- Node.js `>=22`
- uv
- pnpm `>=10` for repository development

## Local Install

From npm:

```bash
npm install -g chump-agent
chump connect
chump
```

The installed binary starts the Python backend with `uvx --from chump-server
chump-server`, so `uv` must be available on your `PATH`.

For repository development, from the `client/` directory:

```bash
pnpm install
pnpm run bin:install
```

That makes the local `chump` binary available on your machine through
`pnpm link`.

## Remove Local Install

```bash
pnpm run bin:uninstall
```

## Development

From the `client/` directory:

```bash
pnpm run dev
pnpm run typecheck
pnpm run build
```

## Packaging

The npm package ships compiled JavaScript from `dist/`; TypeScript sources are
not published as the executable path.

## Publishing

When the package is ready to publish publicly:

```bash
pnpm run build
pnpm publish --access public
```
