# Chump Cloud

A standalone Cloudflare Worker for the free Chump Agent trial path, backed by
Cloudflare AI Gateway and built with Hono.

## Supported models

- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `gemini-3.6-flash`

All model requests use the Worker's `AI` binding and the
`chump_cloud_ai_gateway` gateway. The gateway must have active stored provider
keys using the `default` alias for DeepSeek and the `default2` alias for Google
AI Studio. The Worker selects both provider aliases explicitly. It uses the
binding's pre-authenticated gateway runner, so it does not need provider or AI
Gateway API tokens. AI Gateway caching and request/response logging are disabled
for these requests.

The binding's gateway runner uses Cloudflare's deprecated Universal Endpoint
internally. It is currently the only Worker binding path that supports stored
provider keys without a separate AI Gateway token. Revisit this boundary when
Cloudflare provides a nondeprecated binding method for BYOK provider-native
requests.

`chump-server` sends every hosted model through the same OpenAI-compatible
gateway endpoint. The Worker owns model-to-provider routing; vision-capable
models receive tool-result images as standard multimodal user content after the
corresponding tool messages.

The native Gemini routes remain temporarily available for compatibility with
`chump-server` 0.1.15:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/google/v1beta/models/{model}:generateContent`
- `POST /v1/google/v1beta/models/{model}:streamGenerateContent`

## Rate Limiting

Rate limiting is owned by Cloudflare's edge configuration rather than Worker
code. Configure rate-limiting rules for the inference routes on both custom
domains before exposing them publicly.

## Secrets

Model inference does not require Worker secrets. Provider keys stay in AI
Gateway's Secrets Store, and the `AI` binding authenticates to the gateway within
the same account. The sandbox administration endpoints still require
`CHUMP_SANDBOX_ADMIN_TOKEN`, as described below.

## Sandbox phase 1 scaffold

`chump-cloud` includes an opt-in Cloudflare Sandbox proof-of-concept for running
`chump-server` in an isolated container while keeping inference and billing at
the Worker boundary.

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
`/workspace/.empty-auth.json`. The Worker calls models through its `AI` binding.
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
