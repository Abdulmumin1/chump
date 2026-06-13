import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { currentClientVersion } from "./update.ts";
import { authorizeBearerHeader, DaemonAuthStore } from "./daemon-auth.ts";
import { DAEMON_PROTOCOL_VERSION } from "./daemon-metadata.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import { ProjectSessionRouter } from "./project-sessions.ts";
import { ProjectRegistryStore } from "./projects.ts";

const DAEMON_HOST = "127.0.0.1";
const MAX_JSON_BODY_BYTES = 64 * 1024;

export type DaemonServerOptions = {
  port?: number;
  projectStore?: ProjectRegistryStore;
  version?: string;
  now?: () => number;
  authToken?: string;
  runtimeSupervisor?: ProjectRuntimeSupervisor;
  sessionRouter?: ProjectSessionRouter;
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

    const sessionsMatch = /^\/projects\/([^/]+)\/sessions$/.exec(url.pathname);
    if (sessionsMatch) {
      if (!authorizeBearerHeader(request.headers.authorization, context.authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }
      const projectId = decodeURIComponent(sessionsMatch[1]!);
      const result = await context.sessionRouter.list(projectId);
      if (!result) {
        sendJson(response, 404, { error: "project_not_found" });
        return;
      }
      sendJson(response, 200, result);
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
          : Buffer.from(await readBody(request)).toString("utf8");
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

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, "request_too_large", "request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isAllowedBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
