# chump-server

The backend hosts `ChumpAgent` instances over `ai-query`'s built-in agent
server routes.

## Run

```bash
uv sync
uv run chump-server
```

## Environment

- `CHUMP_HOST`: default `127.0.0.1`
- `CHUMP_PORT`: default `8080`
- `CHUMP_WORKSPACE_ROOT`: defaults to the parent directory of `server/`
- `CHUMP_DATA_DIR`: default `.chump`
- `CHUMP_PROVIDER`: default `openai`; also supports `workers_ai`
- `CHUMP_MODEL`: provider-specific default
- `CHUMP_MAX_STEPS`: default `64`
- `CHUMP_VERBOSE`: default `1`
