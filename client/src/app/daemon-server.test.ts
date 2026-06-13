import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startDaemonServer } from "./daemon-server.ts";
import { ProjectRegistryStore } from "./projects.ts";

test("serves health and projects from a loopback-only server", async (t) => {
  const fixture = await createFixture();
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
    now: () => 100,
  });
  const project = await store.register(fixture.workspacePath, "Example");
  const daemon = await startDaemonServer({
    projectStore: store,
    version: "test-version",
    now: () => 1_000,
    authToken: "test-token-that-is-long-enough-for-auth",
  });
  t.after(() => daemon.close());

  assert.equal(daemon.host, "127.0.0.1");
  assert.match(daemon.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const healthResponse = await fetch(`${daemon.url}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(health.service, "chump-daemon");
  assert.equal(health.version, "test-version");
  assert.equal(health.protocolVersion, 1);

  const unauthorizedResponse = await fetch(`${daemon.url}/projects`);
  assert.equal(unauthorizedResponse.status, 401);

  const projectsResponse = await fetch(`${daemon.url}/projects`, {
    headers: {
      authorization: "Bearer test-token-that-is-long-enough-for-auth",
    },
  });
  assert.equal(projectsResponse.status, 200);
  assert.deepEqual(await projectsResponse.json(), { projects: [project] });
});

test("rejects unsupported methods and unknown routes", async (t) => {
  const fixture = await createFixture();
  const daemon = await startDaemonServer({
    projectStore: new ProjectRegistryStore({
      registryPath: fixture.registryPath,
    }),
    authToken: "test-token-that-is-long-enough-for-auth",
  });
  t.after(() => daemon.close());

  const methodResponse = await fetch(`${daemon.url}/projects`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-that-is-long-enough-for-auth",
    },
  });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET");
  assert.deepEqual(await methodResponse.json(), {
    error: "method_not_allowed",
  });

  const missingResponse = await fetch(`${daemon.url}/missing`);
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "not_found" });
});

async function createFixture(): Promise<{
  workspacePath: string;
  registryPath: string;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "chump-daemon-server-"));
  const workspacePath = path.join(rootPath, "workspace");
  await mkdir(workspacePath);
  return {
    workspacePath,
    registryPath: path.join(rootPath, "projects.json"),
  };
}
