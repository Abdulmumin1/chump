import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { currentClientVersion } from "./update.ts";
import { DAEMON_PROTOCOL_VERSION } from "./daemon-metadata.ts";
import { ProjectRegistryStore } from "./projects.ts";

const DAEMON_HOST = "127.0.0.1";

export type DaemonServerOptions = {
  port?: number;
  projectStore?: ProjectRegistryStore;
  version?: string;
  now?: () => number;
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
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      projectStore,
      version,
      startedAt,
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
};

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${DAEMON_HOST}`);

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
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }
      sendJson(response, 200, {
        projects: await context.projectStore.list(),
      });
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
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
