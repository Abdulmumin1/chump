import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { startDaemonServer } from "./daemon-server.ts";
import type { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import { terminalUpstreamWebSocketInit } from "./terminal-proxy.ts";

const AUTH_TOKEN = "test-token-that-is-long-enough-for-auth";
const PROTOCOLS = ["chump-terminal-v1", `chump-auth.${AUTH_TOKEN}`];

test("uses handshake headers for Bun's standalone WebSocket client", () => {
  assert.deepEqual(
    terminalUpstreamWebSocketInit("https://chmp.dev", true),
    {
      protocols: null,
      options: {
        headers: {
          Origin: "https://chmp.dev",
          "Sec-WebSocket-Protocol": "chump-terminal-v1",
        },
        maxPayload: 1024 * 1024,
      },
    },
  );
});

test("proxies authenticated terminal websocket bytes", async (t) => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  let upstreamRequestUrl = "";
  upstream.on("connection", (socket, request) => {
    upstreamRequestUrl = request.url ?? "";
    socket.on("message", (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
  });
  const address = upstream.address();
  assert(address && typeof address !== "string");

  const runtimeSupervisor = {
    async start(projectId: string) {
      assert.equal(projectId, "project-one");
      return {
        projectId,
        status: "running" as const,
        serverUrl: `http://127.0.0.1:${address.port}`,
        pid: 123,
      };
    },
  } as ProjectRuntimeSupervisor;
  const daemon = await startDaemonServer({
    authToken: AUTH_TOKEN,
    runtimeSupervisor,
  });

  const socket = new WebSocket(
    `${daemon.url.replace("http:", "ws:")}/projects/project-one/terminal?cols=100&rows=30&theme=light`,
    PROTOCOLS,
    { origin: "https://chmp.dev" },
  );
  await once(socket, "open");
  t.after(async () => {
    socket.terminate();
    await daemon.close();
    for (const client of upstream.clients) client.terminate();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  socket.send(Buffer.from([0, 1, 2, 255]), { binary: true });

  const echoed = await receiveBinary(socket);
  assert.deepEqual(echoed, Buffer.from([0, 1, 2, 255]));
  assert.equal(socket.protocol, "chump-terminal-v1");
  assert.equal(upstreamRequestUrl, "/terminal?cols=100&rows=30&theme=light");
});

test("rejects terminal websocket upgrades from untrusted origins", async (t) => {
  const runtimeSupervisor = {
    async start() {
      throw new Error("must not start an unauthorized project runtime");
    },
  } as unknown as ProjectRuntimeSupervisor;
  const daemon = await startDaemonServer({
    authToken: AUTH_TOKEN,
    runtimeSupervisor,
  });
  t.after(() => daemon.close());

  const socket = new WebSocket(
    `${daemon.url.replace("http:", "ws:")}/projects/project-one/terminal`,
    PROTOCOLS,
    { origin: "https://attacker.example" },
  );
  const [request, response] = await once(socket, "unexpected-response");
  assert(request);
  assert.equal(response.statusCode, 403);
  response.resume();
});

test("converts an abnormal upstream close into a legal client close", async (t) => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  upstream.on("connection", (socket) => socket.terminate());
  const address = upstream.address();
  assert(address && typeof address !== "string");

  const runtimeSupervisor = {
    async start(projectId: string) {
      return {
        projectId,
        status: "running" as const,
        serverUrl: `http://127.0.0.1:${address.port}`,
        pid: 123,
      };
    },
  } as ProjectRuntimeSupervisor;
  const daemon = await startDaemonServer({
    authToken: AUTH_TOKEN,
    runtimeSupervisor,
  });
  const socket = new WebSocket(
    `${daemon.url.replace("http:", "ws:")}/projects/project-one/terminal`,
    PROTOCOLS,
    { origin: "https://chmp.dev" },
  );
  t.after(async () => {
    socket.terminate();
    await daemon.close();
    for (const client of upstream.clients) client.terminate();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  await once(socket, "open");
  const [code, reason] = await once(socket, "close");

  assert.equal(code, 1011);
  assert.equal(reason.toString(), "terminal upstream closed unexpectedly");
});

test("rejects malformed project ids without taking down the daemon", async (t) => {
  const runtimeSupervisor = {
    async start() {
      throw new Error("must not start a malformed project id");
    },
  } as unknown as ProjectRuntimeSupervisor;
  const daemon = await startDaemonServer({
    authToken: AUTH_TOKEN,
    runtimeSupervisor,
  });
  t.after(() => daemon.close());

  const socket = new WebSocket(
    `${daemon.url.replace("http:", "ws:")}/projects/%E0%A4%A/terminal`,
    PROTOCOLS,
    { origin: "https://chmp.dev" },
  );
  const [, response] = await once(socket, "unexpected-response");
  assert.equal(response.statusCode, 400);
  response.resume();

  const health = await fetch(`${daemon.url}/health`);
  assert.equal(health.status, 200);
});

async function receiveBinary(socket: WebSocket): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for proxied terminal bytes")),
      5_000,
    );
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (!isBinary) return;
      clearTimeout(timeout);
      socket.off("error", onError);
      socket.off("message", onMessage);
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    };
    const onError = (error: Error) => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}
