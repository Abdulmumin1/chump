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
- `/new` — new session
- `/share` - create a shareable session link
- `/quit`

## License

Apache-2.0
