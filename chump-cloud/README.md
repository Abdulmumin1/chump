# Chump Cloud

A standalone Cloudflare Worker for the free Chump Agent trial path, backed by
DeepSeek and built with Hono.

## Supported models

- `deepseek-v4-flash`
- `deepseek-v4-pro`

The Worker exposes an OpenAI-style API:

- `GET /v1/models`
- `POST /v1/chat/completions`

## Rate Limiting

`POST /v1/chat/completions` is limited to `150` requests per hour per requester
using Cloudflare KV. Create the namespace and put its id in `wrangler.jsonc`:

```bash
cd chump-cloud
wrangler kv namespace create CHUMP_CLOUD_RATE_LIMITS
```

## Secrets

```bash
cd chump-cloud
wrangler secret put DEEPSEEK_API_KEY
```

Chump Cloud does not require a client API key right now. Keep `DEEPSEEK_API_KEY`
private in the Worker environment.

## Sandbox phase 1 scaffold

`chump-cloud` includes an opt-in Cloudflare Sandbox proof-of-concept for running
`chump-server` in an isolated container while keeping provider credentials in the
Worker environment.

The scaffold adds:

- `Dockerfile`: Python 3.12 + `uv` + `chump-server` + git.
- `ChumpSandbox`: a Sandbox Durable Object/container class.
- `POST /sandbox/phase1/start`: starts `chump-server` on port `8080`, exposes it,
  and returns a `chump -c <url>` command.

The endpoint is disabled by default. Enable it only in an environment intended
for sandbox testing:

```bash
cd chump-cloud
wrangler secret put CHUMP_SANDBOX_ADMIN_TOKEN
# set CHUMP_SANDBOX_ENABLED="1" in wrangler.jsonc, or with your deployment env
```

Start a sandbox:

```bash
curl -X POST https://cloud.chmp.dev/sandbox/phase1/start \
  -H "authorization: Bearer $CHUMP_SANDBOX_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"id":"demo","repo":"https://github.com/owner/repo.git"}'
```

For an empty git workspace, omit `repo`. Cloned repositories use
`/workspace/<repo-name>` instead of a fixed `/workspace/repo`. Empty workspaces
default to `/workspace/repo`; pass `"workspace":"name"` to choose a different
directory under `/workspace`.

Back up the current workspace to R2:

```bash
curl -X POST https://cloud.chmp.dev/sandbox/phase1/backup/demo \
  -H "authorization: Bearer $CHUMP_SANDBOX_ADMIN_TOKEN"
```

The legacy `https://chump-cloud.yaqeen.me` domain remains available for
existing clients.

Backups use Cloudflare Sandbox `createBackup()` / `restoreBackup()` with the
`BACKUP_BUCKET` R2 binding. The backup handle is stored in the same bucket and
restored on the next `/sandbox/phase1/start` for the same sandbox id. The backup
captures `/workspace`, including the repo, `.chump-state` SQLite data, and
sandbox-local agent/session config files. Running processes are not snapshotted;
`/start` restores files, then bootstraps `chump-server` again.

Phase 1 intentionally uses `CHUMP_PROVIDER=chump_cloud`; the sandbox receives no
DeepSeek/OpenAI/Anthropic/etc. API key and reads an empty auth file at
`/workspace/.empty-auth.json`. Durable provider credentials stay in the Worker.
Private repository credentials are not handled in this phase; use public repos or
empty workspaces only.

## Local dev

```bash
pnpm install
cd chump-cloud
pnpm dev
```

For local development, put secrets in `chump-cloud/.dev.vars` or `.env`.

## Deploy

```bash
cd chump-cloud
pnpm deploy
```

## Using With chump-server

```bash
export CHUMP_PROVIDER=chump_cloud
export CHUMP_MODEL=deepseek-v4-flash
export OPENAI_BASE_URL="https://<your-worker-domain>/v1"
```

For the larger DeepSeek model:

```bash
export CHUMP_MODEL=deepseek-v4-pro
```
