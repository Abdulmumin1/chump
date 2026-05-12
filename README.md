# chump

> A local coding assistant for your terminal.

`chump` pairs a fast TypeScript CLI with a Python backend to chat with your
codebase, run commands, and edit files.

## Quick start

### Requirements

- Node.js `>=22`
- `uv` on your `PATH`

### Option 1: npm (recommended)

```bash
npm install -g chump-agent
chump           # start coding
```

### Option 2: npx / bunx / pnpm dlx

```bash
npx chump-agent
# or
bunx chump-agent
# or
pnpm dlx chump-agent
```

Run `chump connect` only if you want to use your own provider instead of the
default Chump Cloud trial provider.

### Option 3: Prebuilt binary (no Node.js install needed)

```bash
curl -fsSL https://chump.yaqeen.me/install.sh | bash
```

For Windows:

```powershell
irm https://chump.yaqeen.me/install.ps1 | iex
```

### Option 4: Build from source

```bash
git clone https://github.com/Abdulmumin1/chump.git
cd chump
pnpm install
cd server && uv sync
cd ../client && pnpm run bin:install
chump
```

## Commands

```bash
chump                          # Start interactive CLI
chump client                   # CLI only, no auto-start server
chump -c <url>                 # Connect to existing server
chump server                   # Run backend in foreground
chump status                   # Show server health
chump stop                     # Stop managed server
chump share                    # Share session via tunnel
```

Resume or switch sessions:

```bash
chump -s <session-id>
cd ~/other-project && chump
```

## Slash commands

- `/help` — available commands
- `/sessions` — saved sessions
- `/session <id>` — resume
- `/model` — change provider or model
- `/agent <id>` — switch session
- `/clear` — clear messages
- `/new` — new session
- `/quit`

## Environment

- `CHUMP_PROVIDER` — model provider (`chump_cloud`, `openai`, `google`, `anthropic`, `workers_ai`, `codex`)
- `CHUMP_MODEL` — override default model
- `CHUMP_CLOUD_BASE_URL` — OpenAI-compatible base URL for Chump Cloud
- `CHUMP_MAX_STEPS` — max agent steps per turn (default: `64`)
- `CHUMP_COMMAND_TIMEOUT` — shell command timeout in seconds (default: `120`)
- `CHUMP_VERBOSE` — set to `0` to reduce output
- `CHUMP_WORKSPACE_ROOT` — override workspace root
- `CHUMP_DATA_DIR` — where `.chump/` data lives

## Repo layout

- `client/` — TypeScript CLI (`chump-agent` on npm)
- `server/` — Python backend (`chump-server` on PyPI)
- `web/` — SvelteKit web client
- `chump-cloud/` — standalone Cloudflare Worker for Chump Cloud
- `ai-query/` — agent framework (local editable dependency)
- `onlocal/` — tunneling solution

## License

Apache-2.0
