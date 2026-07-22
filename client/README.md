# chump-agent

TypeScript CLI package for `chump`.

## Requirements

- Node.js `>=22.19`
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

Interactive launches check for a newer `chump-agent` release and print a short
notice when one is available. The check runs alongside startup so it does not
hold up the interface. Disable it with `CHUMP_NO_UPDATE_CHECK=1`.

Update an installed CLI or prebuilt binary:

```bash
chump update
```

## Shell completion

Platform installers automatically generate and enable completion for the shell
that runs the installer (Bash, Zsh, Fish, or PowerShell). Open a new terminal
after installation; no extra setup command is needed. `chump completion
<bash|fish|powershell|zsh>` remains available for package managers or custom
shell configurations.

## Development

From the `client/` directory:

```bash
pnpm run dev
pnpm run typecheck
pnpm run build
```

## TUI Extensions

The interactive client is built on
[`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui).
Its shell exposes named component slots, key handlers, autocomplete providers,
and output transforms. Extensions can be registered in-process through the
`chump-agent/tui` export, or loaded from explicit paths with
`CHUMP_TUI_EXTENSIONS` (separate multiple paths with your platform's path
delimiter).

```ts
import { Text } from "@earendil-works/pi-tui";
import type { ChumpTuiExtension } from "chump-agent/tui";

const extension: ChumpTuiExtension = (ui) => {
  const status = new Text(ui.theme.muted("project extension active"), 1, 0);
  return ui.addComponent("beforeInput", status);
};

export default extension;
```

```bash
CHUMP_TUI_EXTENSIONS=./tools/chump-tui.ts chump
```

Project files are never auto-executed; extension paths must be opted into
explicitly.

## Packaging

GitHub release archives are platform-specific and contain both executables:

```text
chump-<platform>/
  chump
  server/
    chump-server
    _internal/
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
