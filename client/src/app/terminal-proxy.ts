import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  WebSocket,
  WebSocketServer,
  type ClientOptions,
  type RawData,
} from "ws";

import { authorizeBearerHeader } from "./daemon-auth.ts";
import type { ProjectRuntimeSupervisor } from "./project-runtime.ts";

const TERMINAL_PROTOCOL = "chump-terminal-v1";
const AUTH_PROTOCOL_PREFIX = "chump-auth.";
const MAX_TERMINAL_FRAME_BYTES = 1024 * 1024;

export type TerminalProxy = {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean;
  close(): Promise<void>;
};

export function createTerminalProxy(options: {
  authToken: string;
  runtimeSupervisor: ProjectRuntimeSupervisor;
  isAllowedOrigin(origin: string): boolean;
}): TerminalProxy {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_TERMINAL_FRAME_BYTES,
    handleProtocols(protocols) {
      return protocols.has(TERMINAL_PROTOCOL) ? TERMINAL_PROTOCOL : false;
    },
  });

  return {
    handleUpgrade(request, socket, head) {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://127.0.0.1");
      } catch {
        rejectUpgrade(socket, 400, "Bad Request");
        return true;
      }
      const match = /^\/projects\/([^/]+)\/terminal$/.exec(url.pathname);
      if (!match) return false;

      const origin = request.headers.origin;
      if (!origin || !options.isAllowedOrigin(origin)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return true;
      }

      const protocols = readProtocols(request.headers["sec-websocket-protocol"]);
      const tokenProtocol = protocols.find((protocol) =>
        protocol.startsWith(AUTH_PROTOCOL_PREFIX)
      );
      const token = tokenProtocol?.slice(AUTH_PROTOCOL_PREFIX.length);
      if (
        !protocols.includes(TERMINAL_PROTOCOL) ||
        !token ||
        !authorizeBearerHeader(`Bearer ${token}`, options.authToken)
      ) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return true;
      }

      let projectId: string;
      try {
        projectId = decodeURIComponent(match[1]!);
      } catch {
        rejectUpgrade(socket, 400, "Bad Request");
        return true;
      }
      webSocketServer.handleUpgrade(request, socket, head, (client) => {
        void connectProjectTerminal(
          client,
          projectId,
          origin,
          url.searchParams,
          options.runtimeSupervisor,
        );
      });
      return true;
    },
    async close() {
      for (const client of webSocketServer.clients) {
        client.terminate();
      }
      webSocketServer.close();
    },
  };
}

async function connectProjectTerminal(
  client: WebSocket,
  projectId: string,
  origin: string,
  incomingParams: URLSearchParams,
  runtimeSupervisor: ProjectRuntimeSupervisor,
): Promise<void> {
  sendControl(client, { type: "status", status: "connecting" });

  let runtime;
  try {
    runtime = await runtimeSupervisor.start(projectId);
  } catch (error) {
    sendControl(client, {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    client.close(1011, "project runtime failed");
    return;
  }
  if (!runtime?.serverUrl) {
    client.close(1008, "project not found");
    return;
  }
  if (client.readyState !== WebSocket.OPEN) return;

  const upstreamUrl = new URL("/terminal", runtime.serverUrl);
  upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
  for (const name of ["cols", "rows", "theme"]) {
    const value = incomingParams.get(name);
    if (value) upstreamUrl.searchParams.set(name, value);
  }

  const upstreamInit = terminalUpstreamWebSocketInit(origin);
  const upstream = upstreamInit.protocols
    ? new WebSocket(upstreamUrl, upstreamInit.protocols, upstreamInit.options)
    : new WebSocket(upstreamUrl, upstreamInit.options);
  const queuedInput: Array<{ data: RawData; isBinary: boolean }> = [];
  let queuedInputBytes = 0;

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    queuedInputBytes += rawDataLength(data);
    if (queuedInputBytes > MAX_TERMINAL_FRAME_BYTES) {
      client.close(1009, "terminal input queue is too large");
      return;
    }
    queuedInput.push({ data, isBinary });
  });
  client.once("close", () => {
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close();
    }
  });
  client.once("error", () => upstream.terminate());

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  upstream.once("open", () => {
    sendControl(client, { type: "status", status: "connected" });
    for (const message of queuedInput) {
      upstream.send(message.data, { binary: message.isBinary });
    }
    queuedInput.length = 0;
  });
  upstream.once("close", (code, reason) => {
    if (client.readyState === WebSocket.OPEN) {
      closeFromUpstream(client, code, reason.toString());
    }
  });
  upstream.once("error", (error) => {
    sendControl(client, { type: "error", message: error.message });
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, "terminal connection failed");
    }
  });
}

export function terminalUpstreamWebSocketInit(
  origin: string,
  isBun = typeof globalThis.Bun !== "undefined",
): { protocols: string[] | null; options: ClientOptions } {
  if (isBun) {
    // Bun implements the `ws` import with its native WebSocket client. Its
    // compatibility constructor ignores the third `ws` options argument, so
    // pass both required handshake headers through the native two-argument
    // form used by compiled standalone clients.
    return {
      protocols: null,
      options: {
        headers: {
          Origin: origin,
          "Sec-WebSocket-Protocol": TERMINAL_PROTOCOL,
        },
        maxPayload: MAX_TERMINAL_FRAME_BYTES,
      },
    };
  }
  return {
    protocols: [TERMINAL_PROTOCOL],
    options: {
      origin,
      maxPayload: MAX_TERMINAL_FRAME_BYTES,
    },
  };
}

function sendControl(client: WebSocket, value: object): void {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(value));
  }
}

function readProtocols(value: string | string[] | undefined): string[] {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header) return [];
  return header
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

function rawDataLength(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, part) => total + part.byteLength, 0);
  }
  return data.byteLength;
}

function closeFromUpstream(
  client: WebSocket,
  code: number,
  reason: string,
): void {
  try {
    if (isForwardableCloseCode(code)) {
      client.close(code, reason);
    } else {
      client.close(1011, "terminal upstream closed unexpectedly");
    }
  } catch {
    client.terminate();
  }
}

function isForwardableCloseCode(code: number): boolean {
  return (
    (code >= 1000 &&
      code <= 1014 &&
      ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}
