import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureServerTarget,
  parseCliArgs,
} from "./runtime.ts";
import { rotateServerLog } from "./server-command.ts";

test("rotates only one previous server log", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-runtime-log-"));
  const logPath = path.join(rootPath, "server.log");
  await writeFile(logPath, "current log");
  await writeFile(`${logPath}.previous`, "stale previous log");

  rotateServerLog(logPath);

  assert.equal(await readFile(`${logPath}.previous`, "utf8"), "current log");
  await assert.rejects(readFile(logPath, "utf8"), { code: "ENOENT" });
});

test("connect and CHUMP_SERVER_URL use credentials only for the registered local service", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "chump-service-target-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "chump-workspace-"));
  const token = "service-secret-that-is-long-enough-for-private-auth";
  const instanceId = "registered-service-instance";
  const authorizationHeaders: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        status: "ok",
        service: "chump-server",
        version: "0.2.1",
        instance_id: instanceId,
        process_id: process.pid,
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/projects") {
      authorizationHeaders.push(request.headers.authorization ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        project: {
          id: "project-one",
          name: "workspace",
          workspacePath: workspaceRoot,
          createdAt: 1,
          lastOpenedAt: 1,
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
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
      startedAt: "2026-08-24T00:00:00.000Z",
    }),
  );

  const previousStateDirectory = process.env.CHUMP_GLOBAL_STATE_DIR;
  const previousServerUrl = process.env.CHUMP_SERVER_URL;
  process.env.CHUMP_GLOBAL_STATE_DIR = stateDirectory;
  try {
    const connected = await ensureServerTarget(
      workspaceRoot,
      parseCliArgs(["-c", `${serviceUrl}/`]),
    );
    assert.deepEqual(connected.apiTarget, {
      kind: "service",
      projectId: "project-one",
      token,
    });

    process.env.CHUMP_SERVER_URL = serviceUrl;
    const fromEnvironment = await ensureServerTarget(workspaceRoot, parseCliArgs([]));
    assert.deepEqual(fromEnvironment.apiTarget, connected.apiTarget);

    const explicitRemote = await ensureServerTarget(
      workspaceRoot,
      parseCliArgs(["-c", `http://localhost:${address.port}`]),
    );
    assert.deepEqual(explicitRemote.apiTarget, { kind: "direct" });
    assert.deepEqual(authorizationHeaders, [
      `Bearer ${token}`,
      `Bearer ${token}`,
    ]);
  } finally {
    restoreEnvironment("CHUMP_GLOBAL_STATE_DIR", previousStateDirectory);
    restoreEnvironment("CHUMP_SERVER_URL", previousServerUrl);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
