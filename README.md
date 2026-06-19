# chump

coding agent with first class support for collaborative coding. with web/cli and mobile clients..


![chump cli and web ](https://mac-file.yaqeen.me/5CE35DDF-b127847a9978f074f3760f4428c4fc8814df8e7c1ff52452c614a03616435d84.png)


### you need

- Node.js `>=22`
- `uv` on your `PATH`

### npx / bunx / pnpm dlx

```bash
npx chump-agent
# or
bunx chump-agent
# or
pnpx chump-agent
```

Run `chump connect` only if you want to use your own provider instead of the
default Chump Cloud trial provider.

### Prebuilt binary (no Node.js install needed)

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
chump -p "prompt"              # Run one prompt without the TUI
chump -p --verbose "prompt"    # Run one prompt with tool activity on stderr
chump -p --model "openai/gpt-5.4" --thinking low "prompt"  # Run with custom model & thinking
chump client                   # CLI only, no auto-start server
chump -c <url>                 # Connect to existing server
chump app                     # Start daemon and open https://chump.yaqeen.me/c
chump app --web-url http://localhost:5173  # Use a local web app while developing
chump server                   # Run backend in foreground
chump status                   # Show server health
chump providers                # List connected providers and active selection
chump daemon start             # Start the local coordinator
chump daemon status            # Show local coordinator status
chump daemon stop              # Stop the local coordinator
chump projects list            # List registered local projects
chump projects add [path]      # Register a local project
chump projects remove <id>     # Remove a project from the registry
chump stop                     # Stop managed server
chump update                   # Update an installed CLI/binary
chump share                    # Share session via tunnel
chump --version                # Print CLI version
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
- `/new` — new session
- `/share` - create a shareable session link
- `/quit`

## Configuration

Chump supports easy local and global configuration using unified `config.json` files. See the [Configuration Guide](CONFIGURATION.md) for detailed paths, precedence, options, and templates.

## License

Apache-2.0
