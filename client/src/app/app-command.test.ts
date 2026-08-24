import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildServiceConnectUrl,
  DEFAULT_CHUMP_WEB_URL,
  parseAppCommand,
  runAppCommand,
} from "./app-command.ts";

test("parses app command options", () => {
  assert.deepEqual(parseAppCommand([]), {
    open: true,
    json: false,
  });
  assert.deepEqual(
    parseAppCommand(["--web-url", "http://localhost:5173", "--no-open"]),
    {
      webUrl: "http://localhost:5173",
      open: false,
      json: false,
    },
  );
  assert.deepEqual(parseAppCommand(["--json"]), {
    open: false,
    json: true,
  });
  assert.throws(
    () => parseAppCommand(["--web-url"]),
    /missing URL/,
  );
  assert.throws(
    () => parseAppCommand(["extra"]),
    /unexpected app argument/,
  );
});

test("builds service web connect URLs for local development", () => {
  assert.equal(
    buildServiceConnectUrl(
      "http://localhost:5173/?theme=dark",
      "http://127.0.0.1:53080",
      "secret-token",
      "project-one",
    ),
    "http://localhost:5173/?theme=dark#serviceUrl=http%3A%2F%2F127.0.0.1%3A53080&serviceToken=secret-token&projectId=project-one",
  );
  assert.throws(
    () =>
      buildServiceConnectUrl(
        "https://chump.example.com",
        "http://127.0.0.1:53080",
        "secret-token",
        "project-one",
      ),
    /loopback URL/,
  );
});

test("allows the current and legacy hosted chump web apps", () => {
  assert.equal(
    buildServiceConnectUrl(
      DEFAULT_CHUMP_WEB_URL,
      "http://127.0.0.1:53080",
      "secret-token",
      "project-one",
    ),
    "https://chmp.dev/c#serviceUrl=http%3A%2F%2F127.0.0.1%3A53080&serviceToken=secret-token&projectId=project-one",
  );
  assert.equal(
    buildServiceConnectUrl(
      "https://chump.yaqeen.me/c",
      "http://127.0.0.1:53080",
      "secret-token",
      "project-one",
    ),
    "https://chump.yaqeen.me/c#serviceUrl=http%3A%2F%2F127.0.0.1%3A53080&serviceToken=secret-token&projectId=project-one",
  );
});

test("reuses the healthy shared local service for app handoff JSON", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "chump-app-command-"));
  const token = "service-secret-that-is-long-enough-for-private-auth";
  const instanceId = "shared-local-service-instance";
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/projects") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ project: appProject() }));
      return;
    }
    if (request.url !== "/health") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      status: "ok",
      service: "chump-server",
      version: "0.2.1",
      instance_id: instanceId,
      process_id: process.pid,
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const serviceUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(
    path.join(stateDirectory, "service.json"),
    JSON.stringify({
      version: 1,
      url: serviceUrl,
      pid: process.pid,
      serverVersion: "0.2.1",
      instanceId,
      token,
      startedAt: new Date().toISOString(),
    }),
  );

  const originalGlobalStateDir = process.env.CHUMP_GLOBAL_STATE_DIR;
  process.env.CHUMP_GLOBAL_STATE_DIR = stateDirectory;

  try {
    const output = await runAppCommand({
      webUrl: "http://localhost:5173/?theme=dark",
      json: true,
      open: false,
    });

    assert.deepEqual(JSON.parse(output), {
      serviceUrl,
      serviceToken: token,
      projectId: "project-current",
      webUrl: "http://localhost:5173/?theme=dark",
      connectUrl: `http://localhost:5173/?theme=dark#serviceUrl=${encodeURIComponent(serviceUrl)}&serviceToken=${token}&projectId=project-current`,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (originalGlobalStateDir === undefined) {
      delete process.env.CHUMP_GLOBAL_STATE_DIR;
    } else {
      process.env.CHUMP_GLOBAL_STATE_DIR = originalGlobalStateDir;
    }
  }
});

test("does not expose the service token in text mode", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "chump-app-command-"));
  const token = "service-secret-that-is-long-enough-for-private-auth";
  const instanceId = "shared-local-service-instance";
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/projects") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ project: appProject() }));
      return;
    }
    if (request.url !== "/health") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      status: "ok",
      service: "chump-server",
      version: "0.2.1",
      instance_id: instanceId,
      process_id: process.pid,
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const serviceUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(
    path.join(stateDirectory, "service.json"),
    JSON.stringify({
      version: 1,
      url: serviceUrl,
      pid: process.pid,
      serverVersion: "0.2.1",
      instanceId,
      token,
      startedAt: new Date().toISOString(),
    }),
  );

  const originalGlobalStateDir = process.env.CHUMP_GLOBAL_STATE_DIR;
  process.env.CHUMP_GLOBAL_STATE_DIR = stateDirectory;

  try {
    const output = await runAppCommand({
      webUrl: "http://localhost:5173/?theme=dark",
      open: false,
    });

    assert.match(output, /^service: /m);
    assert.doesNotMatch(output, new RegExp(token));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (originalGlobalStateDir === undefined) {
      delete process.env.CHUMP_GLOBAL_STATE_DIR;
    } else {
      process.env.CHUMP_GLOBAL_STATE_DIR = originalGlobalStateDir;
    }
  }
});

function appProject() {
  return {
    id: "project-current",
    name: "chump",
    workspacePath: process.cwd(),
    createdAt: 1,
    lastOpenedAt: 1,
  };
}
