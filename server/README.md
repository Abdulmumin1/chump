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

Pushing a `chump-server-v*` tag runs the PyPI job and creates a GitHub Release in `.github/workflows/release.yml`.

## Environment

- `CHUMP_HOST`: default `127.0.0.1`
- `CHUMP_PORT`: default `8080`
- `CHUMP_WORKSPACE_ROOT`: defaults to the parent directory of `server/`
- `CHUMP_STATE_DIR`: optional override for the workspace state directory; defaults to a per-workspace path under the user's OS state/data directory
- `CHUMP_PROVIDER`: default `chump_cloud`; also supports `codex`, `openai`, `google`, `anthropic`, and `workers_ai`
- `CHUMP_MODEL`: provider-specific default
- `CHUMP_CLOUD_BASE_URL`: optional OpenAI-compatible base URL for the `chump_cloud` provider
- `CHUMP_MAX_STEPS`: default `64`
- `CHUMP_RETRY_MAX_ATTEMPTS`: provider-call retry attempts; default `3`, set `1` to disable
- `CHUMP_RETRY_INITIAL_DELAY`: initial retry delay in seconds; default `0.5`
- `CHUMP_RETRY_MAX_DELAY`: max retry delay in seconds; default `8`
- `CHUMP_RETRY_BACKOFF`: retry delay multiplier; default `2`
- `CHUMP_RETRY_JITTER`: enable retry jitter; default `1`
- `CHUMP_COMMAND_TIMEOUT`: default `120`
- `CHUMP_MANAGED_SERVER_IDLE_TIMEOUT`: optional process idle shutdown timeout in seconds
- `CHUMP_REASONING_EFFORT`: optional OpenAI-compatible reasoning effort
- `CHUMP_REASONING_BUDGET`: optional Gemini-compatible thinking budget
- `CHUMP_VERBOSE`: default `1`
