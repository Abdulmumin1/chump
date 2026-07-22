# Configuration Guide for Chump

Chump supports a unified, cascading configuration system. This allows you to configure your preferred settings globally across all projects, locally for a specific repository, or on-the-fly using environment variables.

---

## Configuration File Paths

Chump reads configuration from JSON files at both the global and project levels.

### 1. Project Configuration (Local)
For repository-specific settings, place a `config.json` file inside the `.chump/` directory at the root of your workspace:
```
<your-project-root>/.chump/config.json
```

### 2. Global Configuration
For system-wide settings, place a `config.json` file in your standard global config/agent directory.
- **macOS**: `~/Library/Application Support/chump/config.json`
- **Windows**: `%APPDATA%\chump\config.json` (usually `C:\Users\<Name>\AppData\Roaming\chump\config.json`)
- **Linux / Unix**: `~/.config/chump/config.json` (respects `XDG_CONFIG_HOME`) or fallbacks to `~/.chump/config.json`
- **Custom Override**: You can force a specific global config file path by setting the `CHUMP_CONFIG_FILE` environment variable.

---

## Precedence Order (Priority)

When resolving any configuration option, Chump looks up values in the following order of priority (highest to lowest):

1. **Environment Variables** (e.g., `CHUMP_PROVIDER`, `CHUMP_MODEL`, etc.)
2. **Project Config File** (`<workspace-root>/.chump/config.json`)
3. **Global Config File** (e.g., `~/.config/chump/config.json`)
4. **Auth Settings** (`auth.json` containing credentials and fallbacks from `chump connect`)
5. **In-Code Defaults**

*Note: If you edit a configuration file, the running background managed server will automatically be detected as obsolete, stopped, and restarted with your new configurations on the next client prompt!*

---

## Available Configuration Options

The following fields can be configured in either your local `.chump/config.json` or global `config.json`:

| Config Key | Type | Env Variable equivalent | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `provider` | `string` | `CHUMP_PROVIDER` | `chump_cloud` | The AI provider to use (`chump_cloud`, `openai`, `anthropic`, `google`, `deepseek`, `workers_ai`, `codex`, `github_copilot`, `openrouter`, `groq`, `xai`, `opencode`, `opencode_go`, `zenmux`). |
| `model` | `string` | `CHUMP_MODEL` | *Depends on provider* | The model name to use under the chosen provider (e.g., `claude-sonnet-4-20250514`, `deepseek-v4-flash`, etc.). |
| `host` | `string` | `CHUMP_HOST` | `127.0.0.1` | Host address for the backend server. |
| `port` | `integer` | `CHUMP_PORT` | `8080` | Port for the backend server. |
| `max_steps` | `integer` | `CHUMP_MAX_STEPS` | `250` | Maximum agent tool-use execution loop steps. |
| `command_timeout` | `integer` | `CHUMP_COMMAND_TIMEOUT` | `120` | Timeout in seconds for running local bash commands. |
| `managed_idle_timeout` | `integer` | `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT` | `30` | Idle timeout in seconds before the managed background server automatically shuts down when not in use. |
| `verbose` | `boolean` | `CHUMP_VERBOSE` | `true` | Enables verbose console logs for the backend server. |
| `theme` | `string` | `CHUMP_THEME` | *Detected* | Force color theme to `light` or `dark` (if not specified, terminal environment is detected). |
| `compaction_tokens` | `integer` | `CHUMP_COMPACTION_TOKENS` | `200000` | Max context tokens before prompting history compaction/truncation. |
| `compaction_keep_recent_tokens` | `integer` | `CHUMP_COMPACTION_KEEP_RECENT_TOKENS` | `20000` | Number of recent tokens to retain during history compaction. |
| `allowed_origins` | `array<str>` / `string` | `CHUMP_ALLOWED_ORIGINS` | *Standard Origins* | List of browser client origins permitted to connect to the backend server. |
| `reasoning` | `object` | *See below* | `None` | Object setting reasoning constraints for models (e.g. `{"effort": "medium", "budget": 2048}`). |

## MCP Servers

Chump can connect to Model Context Protocol servers over local stdio,
Streamable HTTP, or legacy SSE. MCP tools are available through Chump's single
`mcp` tool by default, which avoids filling the model context with every tool
definition. Ask the agent things like:

- “Show my MCP server status.”
- “Find a tool in the context7 MCP server for React documentation.”
- “Add the Context7 remote MCP server to this project.”
- “Why did the github MCP server fail, and can you reconnect it?”

The agent can inspect, call, add, and remove MCP servers with the `mcp` tool.
Project changes are written to `.mcp.json`; global changes are written to
`~/.config/mcp/mcp.json` (or `$XDG_CONFIG_HOME/mcp/mcp.json`). These shared
files use the common `mcpServers` format and can be reused by other agents.
Because local MCP entries can execute commands, project-level entries must set
`"enabled": true`; entries added through the agent include this explicit opt-in.

### Shared `.mcp.json` format

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "enabled": true
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "cwd": ".",
      "enabled": true,
      "env": {
        "PLAYWRIGHT_TOKEN": "${PLAYWRIGHT_TOKEN}"
      }
    }
  }
}
```

Chump loads MCP configuration in this order, with later entries overriding a
server of the same name:

1. Global shared config (`~/.config/mcp/mcp.json`)
2. Global Chump config (`config.json`, under `mcp`)
3. Project shared config (`<workspace>/.mcp.json`)
4. Project Chump config (`<workspace>/.chump/config.json`, under `mcp`)

Both `${NAME}` and `{env:NAME}` environment references are expanded only when
connecting. Keep credentials in environment variables—never commit literal
tokens to an MCP config.

### Chump/OpenCode-style config

MCP servers can also be defined under `mcp` in either Chump `config.json`:

```json
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["npx", "-y", "example-mcp-server"],
      "environment": {
        "API_KEY": "{env:EXAMPLE_API_KEY}"
      },
      "enabled": true
    },
    "remote-server": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${EXAMPLE_TOKEN}"
      }
    }
  }
}
```

Remote servers try Streamable HTTP and then fall back to legacy SSE. Set
`"transport": "http"` or `"transport": "sse"` to force one transport.
Header-based authentication is supported. OAuth is not yet supported.

### Direct tools

Proxy access is the default because large MCP servers can consume substantial
model context. To expose selected tools directly alongside Chump's built-ins,
set `directTools` to `true` or to an allowlist. Direct names use
`mcp_<server>_<tool>`.

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "directTools": ["resolve-library-id", "query-docs"],
      "excludeTools": ["deprecated-tool"],
      "timeout": 30000
    }
  }
}
```

### Nested Retry Customization
You can also customize the API request retry policies using the `retry` object:
```json
{
  "retry": {
    "max_attempts": 3,
    "initial_delay": 0.5,
    "max_delay": 8.0,
    "backoff": 2.0,
    "jitter": true
  }
}
```

---

## Configuration Example (`config.json`)

Here is a fully loaded example of `config.json` configuring Chump to use Anthropic's Claude, a customized reasoning effort, custom port, and specialized compaction rules:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "port": 9000,
  "theme": "dark",
  "max_steps": 250,
  "command_timeout": 300,
  "managed_idle_timeout": 60,
  "verbose": false,
  "compaction": {
    "tokens": 150000,
    "keep_recent_tokens": 30000
  },
  "reasoning": {
    "effort": "high",
    "budget": 4096
  },
  "retry": {
    "max_attempts": 5,
    "initial_delay": 0.25,
    "max_delay": 4.0
  }
}
```
