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
    method: "PUT",
    headers: {
      authorization: "Bearer test-token-that-is-long-enough-for-auth",
    },
  });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET, POST");
  assert.deepEqual(await methodResponse.json(), {
    error: "method_not_allowed",
  });

  const missingResponse = await fetch(`${daemon.url}/missing`);
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "not_found" });
});

test("enforces browser origins and supports approved project mutations", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const daemon = await startDaemonServer({
    projectStore: new ProjectRegistryStore({
      registryPath: fixture.registryPath,
    }),
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    origin: "http://localhost:5173",
  };

  const rejectedOrigin = await fetch(`${daemon.url}/projects`, {
    headers: {
      authorization: `Bearer ${token}`,
      origin: "https://example.com",
    },
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.deepEqual(await rejectedOrigin.json(), {
    error: "origin_not_allowed",
  });

  const preflight = await fetch(`${daemon.url}/projects`, {
    method: "OPTIONS",
    headers: { origin: "http://localhost:5173" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );

  const missingApproval = await fetch(`${daemon.url}/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workspacePath: fixture.workspacePath }),
  });
  assert.equal(missingApproval.status, 400);

  const createResponse = await fetch(`${daemon.url}/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspacePath: fixture.workspacePath,
      name: "Created",
      approved: true,
    }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(
    createResponse.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  const created = await createResponse.json();
  const projectId = created.project.id as string;

  const getResponse = await fetch(`${daemon.url}/projects/${projectId}`, {
    headers,
  });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).project.name, "Created");

  const renameResponse = await fetch(`${daemon.url}/projects/${projectId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name: "Renamed" }),
  });
  assert.equal(renameResponse.status, 200);
  assert.equal((await renameResponse.json()).project.name, "Renamed");

  const deleteResponse = await fetch(`${daemon.url}/projects/${projectId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleteResponse.status, 204);
  assert.equal(await readText(deleteResponse), "");
});

test("rejects invalid JSON and oversized request bodies", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const daemon = await startDaemonServer({
    projectStore: new ProjectRegistryStore({
      registryPath: fixture.registryPath,
    }),
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const invalidJson = await fetch(`${daemon.url}/projects`, {
    method: "POST",
    headers,
    body: "{",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, "invalid_json");

  const oversized = await fetch(`${daemon.url}/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspacePath: "x".repeat(70 * 1024),
      approved: true,
    }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "request_too_large");
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

async function readText(response: Response): Promise<string> {
  return await response.text();
}
