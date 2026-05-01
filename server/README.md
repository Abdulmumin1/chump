# chump-server

The backend hosts `ChumpAgent` instances over `ai-query`'s built-in agent
server routes.

## Run

```bash
uv sync
uv run chump-server
```

## Install

Once published, the backend package can be installed or run directly with `uv`:

```bash
uv tool install chump-server
chump-server
```

or:

```bash
uvx --from chump-server chump-server
```

During repository development, `uv` still uses the local editable `../ai-query`
source from `pyproject.toml`.

## Release

`chump-server` versions come from git tags through `hatch-vcs`.

```bash
git tag chump-server-v0.1.0
git push origin chump-server-v0.1.0
```

Pushing a `chump-server-v*` tag runs the PyPI job in `.github/workflows/release.yml`.

## Environment

- `CHUMP_HOST`: default `127.0.0.1`
- `CHUMP_PORT`: default `8080`
- `CHUMP_WORKSPACE_ROOT`: defaults to the parent directory of `server/`
- `CHUMP_DATA_DIR`: default `.chump`
- `CHUMP_PROVIDER`: default `openai`; also supports `codex`, `google`, `anthropic`, and `workers_ai`
- `CHUMP_MODEL`: provider-specific default
- `CHUMP_MAX_STEPS`: default `64`
- `CHUMP_COMMAND_TIMEOUT`: default `120`
- `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT`: optional process idle shutdown timeout in seconds
- `CHUMP_REASONING_EFFORT`: optional OpenAI-compatible reasoning effort
- `CHUMP_REASONING_BUDGET`: optional Gemini-compatible thinking budget
- `CHUMP_VERBOSE`: default `1`
