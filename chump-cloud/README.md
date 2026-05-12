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
