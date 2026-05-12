import { Hono } from "hono";

type Bindings = {
  DEEPSEEK_API_KEY?: string;
  CHUMP_CLOUD_RATE_LIMITS: KVNamespace;
};

type UpstreamTarget = {
  provider: "deepseek";
  baseUrl: string;
  envKeys: Array<keyof Bindings>;
};

type ChatCompletionRequest = {
  model?: unknown;
  stream?: unknown;
};

type OpenAIStyleError = {
  error: {
    message: string;
    type: string;
  };
};

const CHAT_COMPLETIONS_RATE_LIMIT = 150;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

const app = new Hono<{ Bindings: Bindings }>();

const SUPPORTED_MODELS: Record<string, UpstreamTarget> = {
  "deepseek-v4-flash": {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    envKeys: ["DEEPSEEK_API_KEY"],
  },
  "deepseek-v4-pro": {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    envKeys: ["DEEPSEEK_API_KEY"],
  },
};

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  await next();
});

app.get("/", (c) =>
  Response.json(
    {
      name: "chump-cloud",
      object: "service",
      providers: ["deepseek"],
      models: Object.keys(SUPPORTED_MODELS),
      auth: {
        enabled: false,
      },
    },
    { headers: corsHeaders() },
  ),
);

app.get("/favicon.ico", () => new Response(null, { status: 204, headers: corsHeaders() }));

app.get("/v1/models", () =>
  Response.json(
    {
      object: "list",
      data: Object.entries(SUPPORTED_MODELS).map(([id, target]) => ({
        id,
        object: "model",
        owned_by: target.provider,
      })),
    },
    { headers: corsHeaders() },
  ),
);

app.post("/v1/chat/completions", async (c) => {
  const rateLimit = await reserveRateLimit(c.env.CHUMP_CLOUD_RATE_LIMITS, c.req.raw);
  if (!rateLimit.allowed) {
    return rateLimitError(rateLimit.retryAfterSeconds);
  }

  const body = (await c.req.json()) as ChatCompletionRequest;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const target = SUPPORTED_MODELS[model];
  if (!target) {
    return jsonError(
      400,
      "unsupported_model",
      `Unsupported model: ${model || "(missing)"}`,
    );
  }

  const upstreamKey = readFirstEnv(c.env, target.envKeys);
  if (!upstreamKey) {
    return jsonError(
      500,
      "upstream_not_configured",
      `${target.envKeys.join(" or ")} is not configured`,
    );
  }

  const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstreamKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardHeaders(upstream.headers, body.stream === true),
  });
});

function readFirstEnv(
  env: Bindings,
  keys: Array<keyof Bindings>,
): string | null {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function requesterKey(request: Request): string {
  const ipAddress = request.headers.get("cf-connecting-ip")?.trim();
  const hourBucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  if (ipAddress) {
    return `chat:${hourBucket}:${ipAddress}`;
  }
  return `chat:${hourBucket}:anonymous`;
}

async function reserveRateLimit(
  namespace: KVNamespace,
  request: Request,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const key = requesterKey(request);
  const now = Date.now();
  const resetAt = nextWindowStart(now);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  const current = await namespace.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;

  if (Number.isFinite(count) && count >= CHAT_COMPLETIONS_RATE_LIMIT) {
    return { allowed: false, retryAfterSeconds };
  }

  await namespace.put(key, String(Number.isFinite(count) ? count + 1 : 1), {
    expirationTtl: retryAfterSeconds + 60,
  });
  return { allowed: true };
}

function nextWindowStart(now: number): number {
  return (
    (Math.floor(now / (RATE_LIMIT_WINDOW_SECONDS * 1000)) + 1) *
    RATE_LIMIT_WINDOW_SECONDS *
    1000
  );
}

function forwardHeaders(headers: Headers, streaming: boolean): Headers {
  const next = new Headers(corsHeaders());
  for (const key of ["content-type", "cache-control", "x-request-id"]) {
    const value = headers.get(key);
    if (value) {
      next.set(key, value);
    }
  }
  if (streaming) {
    next.set("x-accel-buffering", "no");
  }
  return next;
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

function jsonError(status: number, type: string, message: string): Response {
  const body: OpenAIStyleError = {
    error: {
      message,
      type,
    },
  };
  return Response.json(body, { status, headers: corsHeaders() });
}

function rateLimitError(retryAfterSeconds: number): Response {
  const headers = new Headers(corsHeaders());
  headers.set("retry-after", String(retryAfterSeconds));
  headers.set("x-ratelimit-limit", String(CHAT_COMPLETIONS_RATE_LIMIT));
  headers.set("x-ratelimit-remaining", "0");
  return Response.json(
    {
      error: {
        message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
        type: "rate_limit_exceeded",
      },
    },
    { status: 429, headers },
  );
}

export default app;
