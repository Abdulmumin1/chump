import { Hono } from "hono";
import {
  type DirectoryBackup,
  getSandbox,
  proxyToSandbox,
  Sandbox as CloudflareSandbox,
} from "@cloudflare/sandbox";
import {
  AI_GATEWAY_ID,
  buildGatewayRequest,
  type ChatCompletionRequest,
  isRecord,
  normalizeGeminiChoices,
  normalizeGeminiSseLine,
  SUPPORTED_MODELS,
} from "./ai-gateway";

type Bindings = {
  CHUMP_SANDBOX_ADMIN_TOKEN?: string;
  CHUMP_SANDBOX_ENABLED?: string;
  AI: Ai;
  BACKUP_BUCKET?: R2Bucket;
  Sandbox: DurableObjectNamespace<ChumpSandbox>;
};

export class ChumpSandbox extends CloudflareSandbox<Bindings> {}

type OpenAIStyleError = {
  error: {
    message: string;
    type: string;
  };
};

type StartSandboxRequest = {
  id?: unknown;
  repo?: unknown;
  model?: unknown;
  workspace?: unknown;
  reset?: unknown;
};

type StoredWorkspaceBackup = {
  backup: DirectoryBackup;
  workspacePath: string;
  createdAt: string;
};

type StoredWorkspaceState = {
  workspacePath: string;
  updatedAt: string;
  lastBackupAt?: string;
};

const CHUMP_SERVER_PORT = 8080;
const CONTAINER_CONTROL_PLANE_TIMEOUT_MS = 30_000;
const CHUMP_SERVER_HEALTH_TIMEOUT_MS = 5_000;
const CHUMP_SERVER_PROXY_TIMEOUT_MS = 30_000;
const CHUMP_SERVER_STREAM_PROXY_TIMEOUT_MS = 60_000;
const CHUMP_SERVER_BOOTSTRAP_TIMEOUT_MS = 15_000;
const SANDBOX_EXEC_TIMEOUT_MS = 30_000;
const CHUMP_SERVER_STARTUP_ATTEMPTS = 30;
const CHUMP_SERVER_STARTUP_DELAY_MS = 1_000;
const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const DEFAULT_SANDBOX_ID = "phase1";
const AUTO_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1_000;

const WORKSPACE_BACKUP_EXCLUDES = [
  // Logs and process output
  "*.log",
  "logs",
  "npm-debug.log*",
  "yarn-debug.log*",
  "yarn-error.log*",
  "pnpm-debug.log*",
  // Node / JS / TS dependencies, package-manager stores, and framework output
  "node_modules",
  ".pnpm-store",
  ".yarn/cache",
  ".yarn/unplugged",
  ".yarn/build-state.yml",
  ".yarn/install-state.gz",
  ".npm",
  ".eslintcache",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".svelte-kit",
  ".next",
  ".nuxt",
  ".angular/cache",
  "dist",
  "build",
  "coverage",
  ".nyc_output",
  // Python environments, bytecode, and tool caches
  ".venv",
  "venv",
  "env",
  "ENV",
  "__pycache__",
  "*.py[cod]",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".hypothesis",
  ".ipynb_checkpoints",
  "htmlcov",
  // Rust / Go / JVM / .NET build outputs
  "target",
  ".gradle",
  ".mvn/wrapper/maven-wrapper.jar",
  ".m2/repository",
  "out",
  ".classpath",
  ".project",
  ".settings",
  "bin/Debug",
  "bin/Release",
  "obj",
  // Ruby / PHP dependency caches
  ".bundle",
  "vendor/bundle",
  "vendor/cache",
  "vendor/bin",
  // C/C++ / native build directories
  "cmake-build-*",
  "CMakeFiles",
  "CMakeCache.txt",
  "compile_commands.json",
  // OS/editor trash
  ".DS_Store",
  "Thumbs.db",
  ".idea",
  ".vscode",
  // Generic cache and temporary directories
  ".cache",
  "tmp",
  "temp",
];

const app = new Hono<{ Bindings: Bindings }>();

app.onError((error) => {
  console.error("[chump-cloud] unhandled error", error);
  return jsonError(500, "internal_error", unknownErrorMessage(error));
});

app.use("*", async (c, next) => {
  const proxied = await proxyToSandbox(c.req.raw, c.env);
  if (proxied) {
    return proxied;
  }
  await next();
});

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
      providers: [...new Set(Object.values(SUPPORTED_MODELS).map((target) => target.provider))],
      models: Object.keys(SUPPORTED_MODELS),
      sandbox: {
        phase1: c.env.CHUMP_SANDBOX_ENABLED === "1" ? "enabled" : "disabled",
      },
      auth: {
        enabled: false,
      },
    },
    { headers: corsHeaders() },
  ),
);

app.post("/sandbox/phase1/start", async (c) => {
  const authError = authorizeSandboxRequest(c.req.raw, c.env);
  if (authError) {
    return authError;
  }

  const body = (await c.req.json().catch(() => ({}))) as StartSandboxRequest;
  const sandboxId = normalizeSandboxId(body.id);
  if (!sandboxId) {
    return jsonError(
      400,
      "invalid_sandbox_id",
      "sandbox id must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/",
    );
  }

  const repo = normalizeRepoUrl(body.repo);
  if (body.repo !== undefined && !repo) {
    return jsonError(
      400,
      "invalid_repo",
      "repo must be an https:// URL ending in .git or a GitHub repository URL",
    );
  }

  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : "deepseek-v4-flash";
  if (!SUPPORTED_MODELS[model]) {
    return jsonError(400, "unsupported_model", `Unsupported model: ${model}`);
  }
  const reset = body.reset === true;

  let step = "get_sandbox";
  try {
    const sandbox = getSandbox(c.env.Sandbox, sandboxId);

    // Fast idempotent path: is sandbox already warm, healthy, and on the correct workspace?
    const isReady = await isChumpServerReady(sandbox);
    if (!reset && isReady) {
      const activeWorkspacePath = await readWorkspacePath(sandbox).catch(() => null);
      const expectedWorkspaceName = normalizeWorkspaceName(body.workspace) ?? workspaceNameFromRepo(repo);
      const expectedWorkspacePath = `/workspace/${expectedWorkspaceName}`;

      if (activeWorkspacePath === expectedWorkspacePath) {
        const { hostname } = new URL(c.req.url);
        const exposed = await sandbox.exposePort(CHUMP_SERVER_PORT, {
          hostname,
          name: "chump-server",
        });
        const localUrl = localConnectUrl(c.req.raw, sandboxId);
        const durability = c.env.BACKUP_BUCKET ? "enabled" : "disabled_missing_bucket";
        return Response.json(
          {
            sandbox_id: sandboxId,
            ready: true,
            workspace: activeWorkspacePath,
            server_url: exposed.url,
            local_server_url: localUrl,
            connect: `chump -c ${exposed.url}`,
            local_connect: localUrl ? `chump -c ${localUrl}` : null,
            durability,
            fast_resume: true,
            credential_boundary:
              "phase1 sandbox receives no durable provider credentials; chump_cloud credentials stay in Worker env",
          },
          { headers: corsHeaders() },
        );
      }
    }

    let restoredWorkspace: { name: string; path: string } | null = null;
    if (reset) {
      step = "reset_workspace";
      await clearWorkspaceBackup(c.env, sandboxId);
      await cleanWorkspace(sandbox);
    } else {
      step = "restore_workspace_backup";
      restoredWorkspace = await restoreWorkspaceBackup(c.env, sandboxId, sandbox);
    }

    step = "prepare_workspace";
    const workspace = restoredWorkspace ?? await prepareWorkspace(sandbox, repo, normalizeWorkspaceName(body.workspace));
    await rememberWorkspaceState(c.env, sandboxId, workspace.path);

    // Fresh start (no restored backup): instantly schedule an initial backup so the session is immediately durable!
    if (!restoredWorkspace && c.env.BACKUP_BUCKET) {
      c.executionCtx.waitUntil(
        backupWorkspace(c.env, sandboxId, sandbox, workspace.path, isLocalRequest(c.req.raw))
          .then(() => rememberWorkspaceBackup(c.env, sandboxId, workspace.path))
          .catch((err) => console.error("[chump-cloud] initial backup failed", err)),
      );
    }

    step = "bootstrap_chump_server";
    await bootstrapChumpServer(sandbox, workspace.path, model, { restartUnhealthyPort: true });

    step = "check_health";
    const ready = await waitForChumpServerReady(
      sandbox,
      CHUMP_SERVER_STARTUP_ATTEMPTS,
      CHUMP_SERVER_STARTUP_DELAY_MS,
    );
    if (!ready) {
      const diagnostics = await readChumpServerDiagnostics(sandbox);
      throw new Error(
        `chump-server failed to listen on port ${CHUMP_SERVER_PORT} within startup timeout\n\n${diagnostics}`,
      );
    }

    step = "expose_port";
    const { hostname } = new URL(c.req.url);
    const exposed = await sandbox.exposePort(CHUMP_SERVER_PORT, {
      hostname,
      name: "chump-server",
    });

    const localUrl = localConnectUrl(c.req.raw, sandboxId);
    const durability = c.env.BACKUP_BUCKET ? "enabled" : "disabled_missing_bucket";
    return Response.json(
      {
        sandbox_id: sandboxId,
        ready: true,
        workspace: workspace.path,
        server_url: exposed.url,
        local_server_url: localUrl,
        connect: `chump -c ${exposed.url}`,
        local_connect: localUrl ? `chump -c ${localUrl}` : null,
        durability,
        fast_resume: false,
        reset,
        credential_boundary:
          "phase1 sandbox receives no durable provider credentials; chump_cloud credentials stay in Worker env",
      },
      { headers: corsHeaders() },
    );
  } catch (error) {
    const log = await readSandboxLog(sandboxId, c.env, "/workspace/chump-server.log");
    console.error(`[chump-cloud] sandbox phase1 failed at ${step}`, error, log);
    return jsonError(
      500,
      "sandbox_phase1_failed",
      `sandbox phase1 failed at ${step}: ${unknownErrorMessage(error)}${log ? `\n\nchump-server.log:\n${log}` : ""}`,
    );
  }
});

app.post("/sandbox/phase1/exec", async (c) => {
  const authError = authorizeSandboxRequest(c.req.raw, c.env);
  if (authError) {
    return authError;
  }

  const body = (await c.req.json().catch(() => ({}))) as StartSandboxRequest;
  const sandboxId = normalizeSandboxId(body.id);
  if (!sandboxId) {
    return jsonError(400, "invalid_sandbox_id", "invalid sandbox id");
  }

  try {
    const sandbox = getSandbox(c.env.Sandbox, sandboxId);
    const result = await withTimeout(
      sandbox.exec(
      "pwd; python --version; command -v chump-server || true; df -h /workspace /tmp 2>/dev/null || df -h; free -m 2>/dev/null || true; ls -la /root/.local/bin | sed -n '1,40p'",
      { timeout: SANDBOX_EXEC_TIMEOUT_MS },
      ),
      CONTAINER_CONTROL_PLANE_TIMEOUT_MS,
      "sandbox control plane did not become ready in time",
    );
    return Response.json({ sandbox_id: sandboxId, result }, { headers: corsHeaders() });
  } catch (error) {
    console.error("[chump-cloud] sandbox phase1 exec failed", error);
    return jsonError(503, "sandbox_exec_failed", unknownErrorMessage(error));
  }
});

app.all("/sandbox/phase1/connect/:id/*", async (c) => {
  const sandboxId = normalizeSandboxId(c.req.param("id"));
  if (!sandboxId) {
    return jsonError(400, "invalid_sandbox_id", "invalid sandbox id");
  }

  const incomingUrl = new URL(c.req.url);
  const prefix = `/sandbox/phase1/connect/${sandboxId}`;
  const upstreamPath = incomingUrl.pathname.slice(prefix.length) || "/";
  const upstreamUrl = new URL(incomingUrl.href);
  upstreamUrl.pathname = upstreamPath;

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  const upstreamRequest = new Request(upstreamUrl, {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
    redirect: "manual",
  });

  const sandbox = getSandbox(c.env.Sandbox, sandboxId);
  try {
    const timeoutMs = proxyTimeoutForPath(upstreamPath, incomingUrl.searchParams);
    const response = await withTimeout(
      sandbox.containerFetch(upstreamRequest, CHUMP_SERVER_PORT),
      timeoutMs,
      "sandbox connect proxy timed out; call /sandbox/phase1/start to resume this sandbox",
    );
    if (!shouldBackupAfterProxy(c.req.method, upstreamPath, response)) {
      return response;
    }
    return responseWithPostCompletionBackup(response, () => {
      c.executionCtx.waitUntil(
        backupCurrentWorkspace(c.env, sandboxId, sandbox, {
          force: false,
          localBucket: isLocalRequest(c.req.raw),
        }),
      );
    });
  } catch (error) {
    console.error("[chump-cloud] sandbox phase1 connect failed", error);
    return jsonError(
      503,
      "sandbox_not_ready",
      `sandbox container/server is not ready; call /sandbox/phase1/start for this sandbox id, then retry: ${unknownErrorMessage(error)}`,
    );
  }
});

app.post("/sandbox/phase1/backup/:id", async (c) => {
  const authError = authorizeSandboxRequest(c.req.raw, c.env);
  if (authError) {
    return authError;
  }
  if (!c.env.BACKUP_BUCKET) {
    return jsonError(503, "sandbox_backups_not_configured", "BACKUP_BUCKET R2 binding is not configured");
  }

  const sandboxId = normalizeSandboxId(c.req.param("id"));
  if (!sandboxId) {
    return jsonError(400, "invalid_sandbox_id", "invalid sandbox id");
  }

  try {
    const sandbox = getSandbox(c.env.Sandbox, sandboxId);
    const workspacePath = await readWorkspacePath(sandbox);
    await rememberWorkspaceState(c.env, sandboxId, workspacePath);
    const backup = await backupWorkspace(c.env, sandboxId, sandbox, workspacePath, isLocalRequest(c.req.raw));
    await rememberWorkspaceBackup(c.env, sandboxId, workspacePath);
    return Response.json(
      { sandbox_id: sandboxId, workspace: workspacePath, backup_id: backup.backup.id, backup_key: workspaceBackupHandleKey(sandboxId) },
      { headers: corsHeaders() },
    );
  } catch (error) {
    return jsonError(500, "sandbox_backup_failed", unknownErrorMessage(error));
  }
});

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
  let parsedBody: unknown;
  try {
    parsedBody = await c.req.json();
  } catch {
    return jsonError(400, "invalid_request", "Request body must be valid JSON");
  }
  if (!isRecord(parsedBody)) {
    return jsonError(400, "invalid_request", "Request body must be a JSON object");
  }
  const body: ChatCompletionRequest = parsedBody;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const target = SUPPORTED_MODELS[model];
  if (!target) {
    return jsonError(
      400,
      "unsupported_model",
      `Unsupported model: ${model || "(missing)"}`,
    );
  }

  const upstream = await c.env.AI.gateway(AI_GATEWAY_ID).run(
    buildGatewayRequest(body, target),
    {
      gateway: {
        id: AI_GATEWAY_ID,
        skipCache: true,
        collectLog: false,
      },
    },
  );

  return target.gatewayProvider === "google-ai-studio"
    ? normalizeGeminiChatCompletion(upstream, body.stream === true)
    : forwardUpstreamResponse(upstream, body.stream === true);
});

function authorizeSandboxRequest(request: Request, env: Bindings): Response | null {
  if (env.CHUMP_SANDBOX_ENABLED !== "1") {
    return jsonError(404, "sandbox_disabled", "sandbox phase1 endpoints are disabled");
  }
  const token = env.CHUMP_SANDBOX_ADMIN_TOKEN?.trim();
  if (!token) {
    return jsonError(
      503,
      "sandbox_auth_not_configured",
      "CHUMP_SANDBOX_ADMIN_TOKEN must be configured before enabling sandbox endpoints",
    );
  }
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (actual !== token) {
    return jsonError(401, "unauthorized", "missing or invalid bearer token");
  }
  return null;
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}

function localConnectUrl(request: Request, sandboxId: string): string | null {
  if (!isLocalRequest(request)) {
    return null;
  }
  const url = new URL(request.url);
  const host = request.headers.get("host")?.trim();
  url.hostname = "localhost";
  if (host?.startsWith("localhost:") || host?.startsWith("127.0.0.1:")) {
    url.port = host.split(":").at(-1) ?? url.port;
  }
  url.pathname = `/sandbox/phase1/connect/${sandboxId}`;
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeSandboxId(value: unknown): string | null {
  const id = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SANDBOX_ID;
  return SANDBOX_ID_PATTERN.test(id) ? id : null;
}

function normalizeRepoUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const url = value.trim();
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.hostname === "github.com" || url.endsWith(".git")) {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeWorkspaceName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return sanitizeWorkspaceName(String(value));
}

function workspaceNameFromRepo(repo: string | null): string {
  if (!repo) {
    return "repo";
  }
  const pathname = new URL(repo).pathname;
  const basename = pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/i, "");
  return sanitizeWorkspaceName(basename || "repo") ?? "repo";
}

function sanitizeWorkspaceName(value: string): string | null {
  const name = value.trim().replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (!name || name === "." || name === ".." || name.includes("..")) {
    return null;
  }
  return name.slice(0, 80);
}

async function prepareWorkspace(
  sandbox: ChumpSandbox,
  repo: string | null,
  requestedName: string | null,
): Promise<{ name: string; path: string }> {
  const name = requestedName ?? workspaceNameFromRepo(repo);
  const path = `/workspace/${name}`;
  await execOrThrow(sandbox, "mkdir -p /workspace && printf '{}' > /workspace/.empty-auth.json");
  if (repo) {
    await execOrThrow(
      sandbox,
      `[ -d ${shellQuote(path)}/.git ] || git clone --depth=1 ${shellQuote(repo)} ${shellQuote(path)}`,
      { timeout: 120_000 },
    );
  } else {
    await execOrThrow(sandbox, `mkdir -p ${shellQuote(path)} && cd ${shellQuote(path)} && ([ -d .git ] || git init)`);
  }
  await execOrThrow(sandbox, `printf %s ${shellQuote(path)} > /workspace/.chump-workspace-path`);
  return { name, path };
}

async function execOrThrow(
  sandbox: ChumpSandbox,
  command: string,
  options?: { timeout?: number },
): Promise<void> {
  const result = await sandbox.exec(command, options);
  if (!result.success) {
    throw new Error(
      `command failed (${result.exitCode}): ${command}\n${result.stdout}${result.stderr}`,
    );
  }
}

async function readSandboxLog(
  sandboxId: string,
  env: Bindings,
  path: string,
): Promise<string | null> {
  try {
    const sandbox = getSandbox(env.Sandbox, sandboxId);
    const result = await sandbox.exec(`[ -f ${shellQuote(path)} ] && tail -200 ${shellQuote(path)} || true`, {
      timeout: 5_000,
    });
    return result.stdout.trim() || result.stderr.trim() || null;
  } catch {
    return null;
  }
}

async function readChumpServerDiagnostics(sandbox: ChumpSandbox): Promise<string> {
  const result = await sandbox.exec(
    [
      "echo '--- process ---'",
      "ps -ef 2>/dev/null | grep '[c]hump-server' || true",
      "echo '--- port ---'",
      `curl -v --max-time 3 http://127.0.0.1:${CHUMP_SERVER_PORT}/health 2>&1 || true`,
      "echo '--- log ---'",
      "[ -f /workspace/chump-server.log ] && tail -200 /workspace/chump-server.log || true",
      "echo '--- disk ---'",
      "df -h /workspace /tmp 2>/dev/null || df -h",
    ].join("; "),
    { timeout: 10_000 },
  );
  return `${result.stdout}${result.stderr}`.trim();
}

async function bootstrapChumpServer(
  sandbox: ChumpSandbox,
  workspacePath: string,
  model: string,
  options: { restartUnhealthyPort: boolean },
): Promise<void> {
  const env = chumpServerEnv(workspacePath, model);
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ");

  const command = `
    cd ${shellQuote(workspacePath)} &&
    mkdir -p /workspace/.chump-state &&
    ${exports};
    if curl -fsS --max-time 1 http://127.0.0.1:${CHUMP_SERVER_PORT}/health >/dev/null 2>&1; then
      echo "chump-server is already running and healthy."
    else
      echo "chump-server is not responding on port ${CHUMP_SERVER_PORT}. cleaning up existing processes..."

      # Kill any process listening on the port
      if command -v fuser >/dev/null 2>&1; then
        fuser -k ${CHUMP_SERVER_PORT}/tcp >/dev/null 2>&1 || true
      fi

      # Terminate any chump-server process
      if command -v pkill >/dev/null 2>&1; then
        pkill -9 -f "chump-server" >/dev/null 2>&1 || true
      elif command -v killall >/dev/null 2>&1; then
        killall -9 "chump-server" >/dev/null 2>&1 || true
      else
        # Standard ps fallback
        kill -9 $(ps -ef 2>/dev/null | grep "[c]hump-server" | awk '{print $2}') >/dev/null 2>&1 || true
      fi

      # Start a clean instance
      echo "starting chump-server..."
      nohup chump-server > /workspace/chump-server.log 2>&1 < /dev/null &

      # Sleep briefly so nohup backgrounding has a moment to start
      sleep 0.5
    fi
  `;

  await sandbox.exec(command, { timeout: CHUMP_SERVER_BOOTSTRAP_TIMEOUT_MS });
}

function chumpServerEnv(workspacePath: string, model: string): Record<string, string> {
  return {
    CHUMP_HOST: "0.0.0.0",
    CHUMP_PORT: String(CHUMP_SERVER_PORT),
    CHUMP_WORKSPACE_ROOT: workspacePath,
    CHUMP_STATE_DIR: "/workspace/.chump-state",
    CHUMP_PROVIDER: "chump_cloud",
    CHUMP_MODEL: model,
    CHUMP_CLOUD_BASE_URL: "https://cloud.chmp.dev/v1",
    CHUMP_AUTH_FILE: "/workspace/.empty-auth.json",
    CHUMP_MANAGED_SERVER_IDLE_TIMEOUT: "900",
  };
}

async function readWorkspacePath(sandbox: ChumpSandbox): Promise<string> {
  const result = await sandbox.exec("cat /workspace/.chump-workspace-path 2>/dev/null || printf /workspace/repo", { timeout: 3_000 });
  const path = result.stdout.trim() || "/workspace/repo";
  if (!path.startsWith("/workspace/") || path.includes("..")) {
    throw new Error(`invalid sandbox workspace path: ${path}`);
  }
  return path;
}

async function backupWorkspace(
  env: Bindings,
  sandboxId: string,
  sandbox: ChumpSandbox,
  workspacePath: string,
  localBucket: boolean,
): Promise<StoredWorkspaceBackup> {
  if (!env.BACKUP_BUCKET) {
    throw new Error("BACKUP_BUCKET R2 binding is not configured");
  }
  if (!workspacePath.startsWith("/workspace/") || workspacePath.includes("..")) {
    throw new Error(`invalid sandbox workspace path: ${workspacePath}`);
  }

  await execOrThrow(sandbox, `printf %s ${shellQuote(workspacePath)} > /workspace/.chump-workspace-path`, { timeout: 5_000 });
  const stored: StoredWorkspaceBackup = {
    backup: await sandbox.createBackup({
      dir: "/workspace",
      name: `chump-${sandboxId}-workspace`,
      ttl: 30 * 24 * 60 * 60,
      localBucket: true, // Force true to always stream via direct DO R2 binding (works in local & production without presigned url bugs)
      excludes: WORKSPACE_BACKUP_EXCLUDES,
    }),
    workspacePath,
    createdAt: new Date().toISOString(),
  };
  await env.BACKUP_BUCKET.put(workspaceBackupHandleKey(sandboxId), JSON.stringify(stored), {
    httpMetadata: { contentType: "application/json" },
  });
  return stored;
}

async function backupCurrentWorkspace(
  env: Bindings,
  sandboxId: string,
  sandbox: ChumpSandbox,
  options: { force: boolean; localBucket: boolean },
): Promise<void> {
  if (!env.BACKUP_BUCKET) {
    return;
  }
  try {
    let workspacePath: string;
    const state = await readWorkspaceState(env, sandboxId);
    if (state) {
      workspacePath = state.workspacePath;
    } else {
      console.warn(`[chump-cloud] workspace state is not recorded for ${sandboxId}; asking sandbox...`);
      workspacePath = await readWorkspacePath(sandbox);
      await rememberWorkspaceState(env, sandboxId, workspacePath);
    }
    if (!options.force && state?.lastBackupAt && backupIsRecent(state.lastBackupAt)) {
      return;
    }
    await backupWorkspace(env, sandboxId, sandbox, workspacePath, options.localBucket);
    await rememberWorkspaceBackup(env, sandboxId, workspacePath);
  } catch (error) {
    console.error(`[chump-cloud] sandbox auto-backup failed for ${sandboxId}`, error);
  }
}

async function cleanWorkspace(sandbox: ChumpSandbox): Promise<void> {
  await execOrThrow(
    sandbox,
    [
      "if command -v pkill >/dev/null 2>&1; then pkill -9 -f 'chump-server' >/dev/null 2>&1 || true; fi",
      "rm -rf /workspace",
      "mkdir -p /workspace",
      "printf '{}' > /workspace/.empty-auth.json",
    ].join("; "),
    { timeout: 30_000 },
  );
}

async function clearWorkspaceBackup(env: Bindings, sandboxId: string): Promise<void> {
  if (!env.BACKUP_BUCKET) {
    return;
  }
  await Promise.all([
    env.BACKUP_BUCKET.delete(workspaceBackupHandleKey(sandboxId)),
    env.BACKUP_BUCKET.delete(workspaceStateKey(sandboxId)),
  ]);
}

async function restoreWorkspaceBackup(
  env: Bindings,
  sandboxId: string,
  sandbox: ChumpSandbox,
): Promise<{ name: string; path: string } | null> {
  if (!env.BACKUP_BUCKET) {
    return null;
  }
  const object = await env.BACKUP_BUCKET.get(workspaceBackupHandleKey(sandboxId));
  if (!object) {
    return null;
  }
  const stored = JSON.parse(await object.text()) as StoredWorkspaceBackup;
  if (!stored.workspacePath.startsWith("/workspace/") || stored.workspacePath.includes("..")) {
    throw new Error(`invalid stored workspace path: ${stored.workspacePath}`);
  }
  await sandbox.restoreBackup(stored.backup);
  await execOrThrow(
    sandbox,
    `mkdir -p /workspace && printf '{}' > /workspace/.empty-auth.json && printf %s ${shellQuote(stored.workspacePath)} > /workspace/.chump-workspace-path`,
    { timeout: 5_000 },
  );
  return { name: stored.workspacePath.split("/").filter(Boolean).at(-1) ?? "repo", path: stored.workspacePath };
}

async function rememberWorkspaceState(env: Bindings, sandboxId: string, workspacePath: string): Promise<void> {
  if (!env.BACKUP_BUCKET) {
    return;
  }
  if (!workspacePath.startsWith("/workspace/") || workspacePath.includes("..")) {
    throw new Error(`invalid workspace path: ${workspacePath}`);
  }
  const existing = await readWorkspaceState(env, sandboxId).catch(() => null);
  const state: StoredWorkspaceState = {
    workspacePath,
    updatedAt: new Date().toISOString(),
    lastBackupAt: existing?.lastBackupAt,
  };
  await env.BACKUP_BUCKET.put(workspaceStateKey(sandboxId), JSON.stringify(state), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function rememberWorkspaceBackup(env: Bindings, sandboxId: string, workspacePath: string): Promise<void> {
  if (!env.BACKUP_BUCKET) {
    return;
  }
  if (!workspacePath.startsWith("/workspace/") || workspacePath.includes("..")) {
    throw new Error(`invalid workspace path: ${workspacePath}`);
  }
  const state: StoredWorkspaceState = {
    workspacePath,
    updatedAt: new Date().toISOString(),
    lastBackupAt: new Date().toISOString(),
  };
  await env.BACKUP_BUCKET.put(workspaceStateKey(sandboxId), JSON.stringify(state), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function readWorkspaceState(env: Bindings, sandboxId: string): Promise<StoredWorkspaceState | null> {
  if (!env.BACKUP_BUCKET) {
    return null;
  }
  const object = await env.BACKUP_BUCKET.get(workspaceStateKey(sandboxId));
  if (!object) {
    return null;
  }
  const state = JSON.parse(await object.text()) as StoredWorkspaceState;
  if (!state.workspacePath.startsWith("/workspace/") || state.workspacePath.includes("..")) {
    throw new Error(`invalid stored workspace path: ${state.workspacePath}`);
  }
  return state;
}

function shouldBackupAfterProxy(method: string, upstreamPath: string, response: Response): boolean {
  if (!response.ok) {
    return false;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    return false;
  }
  if (/^\/agent\/[^/]+\/chat$/.test(upstreamPath)) {
    return true;
  }
  const action = upstreamPath.match(/^\/agent\/[^/]+\/action\/([^/]+)$/)?.[1];
  return [
    "clear_messages",
    "compact",
    "steer_current_turn",
    "cancel_last_steering",
    "cancel_steering",
  ].includes(action ?? "");
}

function proxyTimeoutForPath(upstreamPath: string, searchParams: URLSearchParams): number {
  if (/^\/agent\/[^/]+\/events$/.test(upstreamPath)) {
    return CHUMP_SERVER_STREAM_PROXY_TIMEOUT_MS;
  }
  if (/^\/agent\/[^/]+\/chat$/.test(upstreamPath) && searchParams.get("stream") === "true") {
    return CHUMP_SERVER_STREAM_PROXY_TIMEOUT_MS;
  }
  return CHUMP_SERVER_PROXY_TIMEOUT_MS;
}

function backupIsRecent(lastBackupAt: string): boolean {
  const lastBackupTime = Date.parse(lastBackupAt);
  if (!Number.isFinite(lastBackupTime)) {
    return false;
  }
  return Date.now() - lastBackupTime < AUTO_BACKUP_MIN_INTERVAL_MS;
}

function responseWithPostCompletionBackup(response: Response, onComplete: () => void): Response {
  if (!response.body) {
    onComplete();
    return response;
  }

  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    flush() {
      onComplete();
    },
  }));
  return new Response(body, response);
}

function workspaceBackupHandleKey(sandboxId: string): string {
  return `sandboxes/${sandboxId}/workspace-backup.json`;
}

function workspaceStateKey(sandboxId: string): string {
  return `sandboxes/${sandboxId}/workspace-state.json`;
}

async function waitForChumpServerReady(
  sandbox: ChumpSandbox,
  attempts: number,
  delayMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isChumpServerReady(sandbox)) {
      return true;
    }
    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }
  return false;
}

async function isChumpServerReady(sandbox: ChumpSandbox): Promise<boolean> {
  try {
    const response = await sandbox.containerFetch(
      new Request("http://localhost/health", {
        signal: AbortSignal.timeout(CHUMP_SERVER_HEALTH_TIMEOUT_MS),
      }),
      CHUMP_SERVER_PORT,
    );
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

function forwardUpstreamResponse(upstream: Response, streaming: boolean): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwardHeaders(upstream.headers, streaming),
  });
}

async function normalizeGeminiChatCompletion(
  upstream: Response,
  streaming: boolean,
): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    return forwardUpstreamResponse(upstream, streaming);
  }

  const headers = forwardHeaders(upstream.headers, streaming);
  if (streaming) {
    return new Response(upstream.body.pipeThrough(geminiSseNormalizer()), {
      status: upstream.status,
      headers,
    });
  }

  const rawBody = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(rawBody, { status: upstream.status, headers });
  }

  normalizeGeminiChoices(body);
  return new Response(JSON.stringify(body), { status: upstream.status, headers });
}

function geminiSseNormalizer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const choicesWithToolCalls = new Set<number>();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        controller.enqueue(encoder.encode(`${normalizeGeminiSseLine(line, choicesWithToolCalls)}\n`));
        newlineIndex = buffer.indexOf("\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) {
        controller.enqueue(encoder.encode(normalizeGeminiSseLine(buffer, choicesWithToolCalls)));
      }
    },
  });
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

export default app;
