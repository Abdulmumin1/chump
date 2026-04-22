# chump-cli

TypeScript CLI package for `chump`.

## Requirements

- Node.js `>=22`
- pnpm `>=10`

## Local Install

From the `client/` directory:

```bash
pnpm install
pnpm run bin:install
```

That makes the `chump` binary available on your machine through `pnpm link`.

## Remove Local Install

```bash
pnpm run bin:uninstall
```

## Development

```bash
pnpm run dev
pnpm run typecheck
```

## Publishing

When the package is ready to publish publicly:

```bash
pnpm publish --access public
```

The package currently ships the TypeScript entrypoint directly and expects
Node 22's native type stripping at runtime.

