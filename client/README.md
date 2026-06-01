# chump-agent

TypeScript CLI package for `chump`.

## Requirements

- Node.js `>=22`
- pnpm `>=10` for repository development

## Local Install

From npm:

```bash
npm install -g chump-agent
chump connect
chump
chump -p "summarize this repo"
```

Standalone release archives include both `chump` and the matching
`chump-server` backend binary. The CLI starts that bundled backend directly;
`uv` is not required for normal installs.

Use the platform archives or installer scripts for the no-`uv` path. The npm
package is still useful for development and JS-package consumers.

Use `chump -p "prompt"` for one-shot, non-interactive prompts. Piped stdin is
merged into the prompt, and stdout is reserved for the assistant response. Add
`--verbose` to print client-side diagnostics and tool activity to stderr.

You can also specify a model using `--model <provider>/<model>` (e.g., `--model openai/gpt-5.4`)
and configure thinking limits using `--thinking <none|low|high|xhigh>`.

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

## Updates

Interactive launches check for a newer `chump-agent` release at most once per
day and print a short notice when one is available. Disable this with
`CHUMP_NO_UPDATE_CHECK=1`.

Update an installed CLI or prebuilt binary:

```bash
chump update
```

## Development

From the `client/` directory:

```bash
pnpm run dev
pnpm run typecheck
pnpm run build
```

## Packaging

GitHub release archives are platform-specific and contain both executables:

```text
chump-<platform>/
  chump
  chump-server-<platform>
```

Repository development still uses the local Python backend through `uv run`.
Override backend startup with `CHUMP_SERVER_BIN=/path/to/chump-server` and,
when needed, `CHUMP_SERVER_ARGS='["--flag"]'` while testing custom server
builds.

## Publishing

When the package is ready to publish publicly:

```bash
pnpm run build
pnpm publish --access public
```
