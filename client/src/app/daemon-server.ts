import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DEFAULT_CHUMP_WEB_URL } from "./app-config.ts";
import { currentClientVersion } from "./update.ts";
import { authorizeBearerHeader, DaemonAuthStore } from "./daemon-auth.ts";
import { DAEMON_PROTOCOL_VERSION } from "./daemon-metadata.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import {
  ProjectSessionRouter,
  SessionCreationError,
} from "./project-sessions.ts";
import { ProjectRegistryStore } from "./projects.ts";
import { pickDirectory } from "./directory-picker.ts";

const DAEMON_HOST = "127.0.0.1";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_SESSION_BODY_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export type DaemonServerOptions = {
  port?: number;
  projectStore?: ProjectRegistryStore;
  version?: string;
  now?: () => number;
  authToken?: string;
  runtimeSupervisor?: ProjectRuntimeSupervisor;
  sessionRouter?: ProjectSessionRouter;
  pickDirectory?: () => Promise<string | null>;
};

export type RunningDaemonServer = {
  host: typeof DAEMON_HOST;
  port: number;
  url: string;
  close(): Promise<void>;
};

export async function startDaemonServer(
  options: DaemonServerOptions = {},
): Promise<RunningDaemonServer> {
  const projectStore = options.projectStore ?? new ProjectRegistryStore();
  const version = options.version ?? currentClientVersion();
  const startedAt = options.now?.() ?? Date.now();
  const authToken = options.authToken ?? await new DaemonAuthStore().getOrCreateToken();
  const runtimeSupervisor =
    options.runtimeSupervisor ?? new ProjectRuntimeSupervisor(projectStore);
  const sessionRouter =
    options.sessionRouter ?? new ProjectSessionRouter(runtimeSupervisor);
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      projectStore,
      version,
      startedAt,
      authToken,
      runtimeSupervisor,
      sessionRouter,
      pickDirectory: options.pickDirectory ?? pickDirectory,
    });
  });

  await listen(server, options.port ?? 0);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("daemon did not bind a TCP port");
  }

  return {
    host: DAEMON_HOST,
    port: address.port,
    url: `http://${DAEMON_HOST}:${address.port}`,
    close: () => closeServer(server),
  };
}

type RequestContext = {
  projectStore: ProjectRegistryStore;
  version: string;
  startedAt: number;
  authToken: string;
  runtimeSupervisor: ProjectRuntimeSupervisor;
  sessionRouter: ProjectSessionRouter;
  pickDirectory: () => Promise<string | null>;
};

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${DAEMON_HOST}`);
    const origin = request.headers.origin;

    if (origin && !isAllowedBrowserOrigin(origin)) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    if (origin) {
      setCorsHeaders(response, origin);
    }
    if (method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.setHeader("access-control-allow-headers", "authorization, content-type");
      response.end();
      return;
    }

    if (url.pathname === "/health") {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }
      sendJson(response, 200, {
        status: "ok",
        service: "chump-daemon",
        version: context.version,
        protocolVersion: DAEMON_PROTOCOL_VERSION,
        uptimeSeconds: Math.max(0, (Date.now() - context.startedAt) / 1_000),
      });
      return;
    }

    if (url.pathname === "/projects") {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (method === "GET") {
        sendJson(response, 200, {
          projects: await context.projectStore.list(),
        });
        return;
      }
      if (method === "POST") {
        const body = await readJsonBody(request);
        if (
          !isRecord(body) ||
          typeof body.workspacePath !== "string" ||
          body.approved !== true ||
          (body.name !== undefined && typeof body.name !== "string")
        ) {
          sendJson(response, 400, {
            error: "invalid_request",
            message: "workspacePath and approved: true are required",
          });
          return;
        }
        const project = await context.projectStore.register(
          body.workspacePath,
          body.name,
        );
        sendJson(response, 201, { project });
        return;
      }
      sendMethodNotAllowed(response, ["GET", "POST"]);
      return;
    }

    if (url.pathname === "/directory-picker") {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }
      sendJson(response, 200, {
        workspacePath: await context.pickDirectory(),
      });
      return;
    }

    const projectMatch = /^\/projects\/([^/]+)$/.exec(url.pathname);
    if (projectMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const projectId = decodeURIComponent(projectMatch[1]!);
      if (method === "GET") {
        const project = await context.projectStore.get(projectId);
        if (!project) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, { project });
        return;
      }
      if (method === "PATCH") {
        const body = await readJsonBody(request);
        if (!isRecord(body) || typeof body.name !== "string") {
          sendJson(response, 400, {
            error: "invalid_request",
            message: "name is required",
          });
          return;
        }
        const project = await context.projectStore.rename(projectId, body.name);
        if (!project) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, { project });
        return;
      }
      if (method === "DELETE") {
        const removed = await context.projectStore.remove(projectId);
        if (!removed) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        response.statusCode = 204;
        response.end();
        return;
      }
      sendMethodNotAllowed(response, ["GET", "PATCH", "DELETE"]);
      return;
    }

    const runtimeMatch = /^\/projects\/([^/]+)\/runtime$/.exec(url.pathname);
    if (runtimeMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const projectId = decodeURIComponent(runtimeMatch[1]!);
      if (method === "GET") {
        const runtime = await context.runtimeSupervisor.status(projectId);
        if (!runtime) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, { runtime });
        return;
      }
      if (method === "POST") {
        const runtime = await context.runtimeSupervisor.start(projectId);
        if (!runtime) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, { runtime });
        return;
      }
      if (method === "DELETE") {
        const runtime = await context.runtimeSupervisor.stop(projectId);
        if (!runtime) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, { runtime });
        return;
      }
      sendMethodNotAllowed(response, ["GET", "POST", "DELETE"]);
      return;
    }

    const gitActionMatch = /^\/projects\/([^/]+)\/git\/(commit-push|commit|push|create-pr)$/.exec(url.pathname);
    if (gitActionMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }
      const projectId = decodeURIComponent(gitActionMatch[1]!);
      const action = gitActionMatch[2] as "commit-push" | "commit" | "push" | "create-pr";
      const project = await context.projectStore.get(projectId);
      if (!project) {
        sendJson(response, 404, { error: "project_not_found" });
        return;
      }
      const body = await readOptionalJsonBody(request);
      if ((action === "commit" || action === "commit-push") && typeof body.message !== "string") {
        sendJson(response, 400, {
          error: "invalid_request",
          message: "message is required",
        });
        return;
      }
      const files = readGitActionFiles(body.files);
      if ((action === "commit" || action === "commit-push") && files.length === 0) {
        sendJson(response, 400, {
          error: "invalid_request",
          message: "select at least one file to commit",
        });
        return;
      }
      const result = await runProjectGitAction(project.workspacePath, action, {
        message: typeof body.message === "string" ? body.message : undefined,
        files,
        prTitle: typeof body.title === "string" ? body.title : undefined,
        prBody: typeof body.body === "string" ? body.body : undefined,
        draft: body.draft === true,
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    const sessionsMatch = /^\/projects\/([^/]+)\/sessions$/.exec(url.pathname);
    if (sessionsMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const projectId = decodeURIComponent(sessionsMatch[1]!);
      if (method === "GET") {
        const result = await context.sessionRouter.list(projectId, url.search);
        if (!result) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        sendJson(response, 200, result);
        return;
      }
      if (method === "POST") {
        const body = await readOptionalJsonBody(request);
        if (
          !isRecord(body) ||
          (body.sessionId !== undefined && typeof body.sessionId !== "string")
        ) {
          sendJson(response, 400, {
            error: "invalid_request",
            message: "sessionId must be a string when provided",
          });
          return;
        }
        try {
          const created = await context.sessionRouter.create(
            projectId,
            body.sessionId,
          );
          if (!created) {
            sendJson(response, 404, { error: "project_not_found" });
            return;
          }
          sendJson(response, 201, created);
        } catch (error) {
          if (error instanceof SessionCreationError) {
            sendJson(
              response,
              error.code === "session_exists" ? 409 : 400,
              { error: error.code, message: error.message },
            );
            return;
          }
          throw error;
        }
        return;
      }
      sendMethodNotAllowed(response, ["GET", "POST"]);
      return;
    }

    const projectProxyMatch = /^\/projects\/([^/]+)\/(health|files)$/.exec(
      url.pathname,
    );
    if (projectProxyMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }
      const projectId = decodeURIComponent(projectProxyMatch[1]!);
      const route = projectProxyMatch[2] as "health" | "files";
      const upstream = await context.sessionRouter.projectRequest(
        projectId,
        route,
        url.search,
      );
      if (!upstream) {
        sendJson(response, 404, { error: "project_not_found" });
        return;
      }
      await sendUpstreamResponse(response, upstream);
      return;
    }

    const sessionRouteMatch =
      /^\/projects\/([^/]+)\/sessions\/([^/]+)\/(state|messages|action\/[^/]+)$/
        .exec(url.pathname);
    if (sessionRouteMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const projectId = decodeURIComponent(sessionRouteMatch[1]!);
      const sessionId = decodeURIComponent(sessionRouteMatch[2]!);
      const route = sessionRouteMatch[3]!;
      const allowedMethods =
        route === "state" || route === "messages"
          ? ["GET"]
          : ["POST"];
      if (!allowedMethods.includes(method)) {
        sendMethodNotAllowed(response, allowedMethods);
        return;
      }
      const body =
        method === "GET"
          ? undefined
          : Buffer.from(
              await readBody(
                request,
                route === "action/steer_current_turn"
                  ? MAX_SESSION_BODY_BYTES
                  : MAX_JSON_BODY_BYTES,
              ),
            ).toString("utf8");
      const upstream = await context.sessionRouter.request(
        projectId,
        sessionId,
        {
          method,
          path: route as "state" | "messages" | `action/${string}`,
          query: url.search,
          headers: forwardedRequestHeaders(request),
          body,
        },
      );
      if (!upstream) {
        sendJson(response, 404, { error: "project_not_found" });
        return;
      }
      await sendUpstreamResponse(response, upstream);
      return;
    }

    const sessionStreamMatch =
      /^\/projects\/([^/]+)\/sessions\/([^/]+)\/(chat|events)$/
        .exec(url.pathname);
    if (sessionStreamMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const projectId = decodeURIComponent(sessionStreamMatch[1]!);
      const sessionId = decodeURIComponent(sessionStreamMatch[2]!);
      const route = sessionStreamMatch[3] as "chat" | "events";
      const expectedMethod = route === "chat" ? "POST" : "GET";
      if (method !== expectedMethod) {
        sendMethodNotAllowed(response, [expectedMethod]);
        return;
      }
      const controller = new AbortController();
      const abortUpstream = () => controller.abort();
      request.once("aborted", abortUpstream);
      response.once("close", abortUpstream);
      try {
        const body =
          route === "chat"
            ? Buffer.from(
                await readBody(request, MAX_SESSION_BODY_BYTES),
              ).toString("utf8")
            : undefined;
        const upstream = await context.sessionRouter.request(
          projectId,
          sessionId,
          {
            method,
            path: route,
            query: url.search,
            headers: forwardedRequestHeaders(request),
            body,
            signal: controller.signal,
          },
        );
        if (!upstream) {
          sendJson(response, 404, { error: "project_not_found" });
          return;
        }
        await streamUpstreamResponse(response, upstream, controller.signal);
      } finally {
        request.off("aborted", abortUpstream);
        response.off("close", abortUpstream);
      }
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(response, error.status, {
        error: error.code,
        message: error.message,
      });
      return;
    }
    sendJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  try {
    return JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid_json", "request body must be valid JSON");
  }
}

async function readOptionalJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const body = await readBody(request);
  if (body.byteLength === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
    if (!isRecord(parsed)) {
      throw new RequestError(400, "invalid_json", "request body must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "invalid_json", "request body must be valid JSON");
  }
}

async function readBody(
  request: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new RequestError(413, "request_too_large", "request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isAllowedBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (
      url.protocol === "https:" &&
      url.origin === new URL(DEFAULT_CHUMP_WEB_URL).origin
    ) {
      return true;
    }
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function setCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
}

function forwardedRequestHeaders(
  request: IncomingMessage,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["accept", "content-type", "last-event-id"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

async function sendUpstreamResponse(
  response: ServerResponse,
  upstream: Response,
): Promise<void> {
  response.statusCode = upstream.status;
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  const body = new Uint8Array(await upstream.arrayBuffer());
  response.end(body);
}

async function streamUpstreamResponse(
  response: ServerResponse,
  upstream: Response,
  signal: AbortSignal,
): Promise<void> {
  response.statusCode = upstream.status;
  copyUpstreamHeaders(response, upstream, [
    "content-type",
    "cache-control",
    "connection",
  ]);
  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(value)) {
        await once(response, "drain");
      }
    }
  } finally {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
    }
  }
  if (!response.destroyed && !response.writableEnded) {
    response.end();
  }
}

function copyUpstreamHeaders(
  response: ServerResponse,
  upstream: Response,
  names: string[],
): void {
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readGitActionFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const files: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const path = item.trim();
    if (!path || path.startsWith("/") || path.includes("\0") || path.split(/[\\/]/).includes("..")) continue;
    files.push(path);
  }
  return Array.from(new Set(files));
}

async function runProjectGitAction(
  workspacePath: string,
  action: "commit-push" | "commit" | "push" | "create-pr",
  options: { message?: string; files?: string[]; prTitle?: string; prBody?: string; draft?: boolean } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; message: string; url?: string }> {
  try {
    const prArgs = buildCreatePrArgs(options);
    const results =
      action === "commit" || action === "commit-push"
        ? [
            await runWorkspaceCommand(workspacePath, "git", [
              "add",
              "-A",
              "--",
              ...(options.files ?? []),
            ]),
            await runWorkspaceCommand(workspacePath, "git", [
              "commit",
              "-m",
              options.message ?? "Update workspace",
            ]),
            ...(action === "commit-push"
              ? [await runWorkspaceCommand(workspacePath, "git", ["push", "-u", "origin", "HEAD"])]
              : []),
          ]
        : [
            await runWorkspaceCommand(
              workspacePath,
              action === "create-pr" ? "gh" : "git",
              action === "create-pr" ? prArgs : ["push", "-u", "origin", "HEAD"],
            ),
          ];
    const stdout = results.map((result) => result.stdout).join("\n");
    const stderr = results.map((result) => result.stderr).join("\n");
    const url = action === "create-pr" ? extractPullRequestUrl(stdout, stderr) : undefined;
    return {
      ok: true,
      stdout,
      stderr,
      message: url ?? (compactGitOutput(stdout, stderr) || gitActionSuccessMessage(action)),
      url,
    };
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = stringifyOutput(failure.stdout);
    const stderr = stringifyOutput(failure.stderr);
    return {
      ok: false,
      stdout,
      stderr,
      message: compactGitOutput(stdout, stderr) || failure.message || "git push failed",
    };
  }
}

function buildCreatePrArgs(options: { prTitle?: string; prBody?: string; draft?: boolean }): string[] {
  const title = options.prTitle?.trim();
  const body = options.prBody?.trim();
  const args = ["pr", "create"];
  if (!title && !body) {
    args.push("--fill");
  } else {
    args.push("--fill");
    if (title) args.push("--title", title);
    if (body) args.push("--body", body);
  }
  if (options.draft) args.push("--draft");
  return args;
}

function extractPullRequestUrl(stdout: string, stderr: string): string | undefined {
  const match = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/u.exec(`${stdout}\n${stderr}`);
  return match?.[0];
}

async function runWorkspaceCommand(
  workspacePath: string,
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(file, args, {
    cwd: workspacePath,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}

function gitActionSuccessMessage(action: "commit-push" | "commit" | "push" | "create-pr"): string {
  switch (action) {
    case "commit-push":
      return "Committed and pushed changes";
    case "commit":
      return "Committed changes";
    case "create-pr":
      return "Created pull request";
    case "push":
      return "Pushed changes";
  }
}

function stringifyOutput(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value ?? "";
}

function compactGitOutput(stdout: string, stderr: string): string {
  return [stdout, stderr]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n");
}

class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, DAEMON_HOST);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sendMethodNotAllowed(response: ServerResponse, allowed: string[]): void {
  response.setHeader("allow", allowed.join(", "));
  sendJson(response, 405, { error: "method_not_allowed" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(body)}\n`);
}
