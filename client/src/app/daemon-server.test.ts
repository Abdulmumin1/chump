import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { startDaemonServer } from "./daemon-server.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";
import { ProjectSessionRouter } from "./project-sessions.ts";
import { ProjectRegistryStore } from "./projects.ts";

const execFileAsync = promisify(execFile);

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

test("opens an authenticated native directory picker", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  let calls = 0;
  const daemon = await startDaemonServer({
    projectStore: new ProjectRegistryStore({
      registryPath: fixture.registryPath,
    }),
    authToken: token,
    pickDirectory: async () => {
      calls += 1;
      return fixture.workspacePath;
    },
  });
  t.after(() => daemon.close());

  const unauthorized = await fetch(`${daemon.url}/directory-picker`, {
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);

  const selected = await fetch(`${daemon.url}/directory-picker`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(await selected.json(), {
    workspacePath: fixture.workspacePath,
  });
  assert.equal(calls, 1);
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

  const hostedPreflight = await fetch(`${daemon.url}/projects`, {
    method: "OPTIONS",
    headers: { origin: "https://chump.yaqeen.me" },
  });
  assert.equal(hostedPreflight.status, 204);
  assert.equal(
    hostedPreflight.headers.get("access-control-allow-origin"),
    "https://chump.yaqeen.me",
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

test("starts, reports, and stops project runtimes through the daemon", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  let running = false;
  const runtimeSupervisor = new ProjectRuntimeSupervisor(store, {
    ensureServer: async (workspacePath) => {
      running = true;
      return {
        started: true,
        metadata: runtimeMetadata(workspacePath),
      };
    },
    readServer: async (workspacePath) =>
      running ? runtimeMetadata(workspacePath) : null,
    stopServer: async () => {
      running = false;
      return "stopped";
    },
  });
  const daemon = await startDaemonServer({
    projectStore: store,
    runtimeSupervisor,
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = { authorization: `Bearer ${token}` };
  const runtimeUrl = `${daemon.url}/projects/${project.id}/runtime`;

  const stoppedResponse = await fetch(runtimeUrl, { headers });
  assert.equal(stoppedResponse.status, 200);
  assert.equal((await stoppedResponse.json()).runtime.status, "stopped");

  const startResponse = await fetch(runtimeUrl, {
    method: "POST",
    headers,
  });
  assert.equal(startResponse.status, 200);
  assert.deepEqual((await startResponse.json()).runtime, {
    projectId: project.id,
    status: "running",
    serverUrl: "http://127.0.0.1:9000",
    pid: 123,
  });

  const runningResponse = await fetch(runtimeUrl, { headers });
  assert.equal((await runningResponse.json()).runtime.status, "running");

  const stopResponse = await fetch(runtimeUrl, {
    method: "DELETE",
    headers,
  });
  assert.equal(stopResponse.status, 200);
  assert.equal((await stopResponse.json()).runtime.status, "stopped");

  const missingResponse = await fetch(
    `${daemon.url}/projects/missing/runtime`,
    { method: "POST", headers },
  );
  assert.equal(missingResponse.status, 404);
});

test("lists sessions for a selected project through the daemon", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  const runtimeSupervisor = new ProjectRuntimeSupervisor(store, {
    ensureServer: async (workspacePath) => ({
      started: true,
      metadata: runtimeMetadata(workspacePath),
    }),
  });
  const sessionRouter = new ProjectSessionRouter(runtimeSupervisor, {
    fetch: async () => Response.json({
      sessions: [{
        id: "session-one",
        active: false,
        message_count: 1,
        event_count: 2,
        title: null,
        created_at: 1,
        updated_at: 2,
        last_user_goal: null,
        last_activity: null,
        connections: 0,
      }],
    }),
  });
  const daemon = await startDaemonServer({
    projectStore: store,
    runtimeSupervisor,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());

  const response = await fetch(
    `${daemon.url}/projects/${project.id}/sessions`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: project.id,
    sessions: [{
      id: "session-one",
      active: false,
      message_count: 1,
      event_count: 2,
      title: null,
      created_at: 1,
      updated_at: 2,
      last_user_goal: null,
      last_activity: null,
      connections: 0,
    }],
    page: 1,
    page_size: 1,
    total: 1,
    total_pages: 1,
  });
});

test("creates project-scoped session handles", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  const sessionRouter = {
    create: async (projectId: string, sessionId?: string) => ({
      projectId,
      sessionId: sessionId ?? "generated-session",
    }),
  } as unknown as ProjectSessionRouter;
  const daemon = await startDaemonServer({
    projectStore: store,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());
  const url = `${daemon.url}/projects/${project.id}/sessions`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const generated = await fetch(url, {
    method: "POST",
    headers,
  });
  assert.equal(generated.status, 201);
  assert.deepEqual(await generated.json(), {
    projectId: project.id,
    sessionId: "generated-session",
  });

  const requested = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "requested-session" }),
  });
  assert.equal(requested.status, 201);
  assert.equal((await requested.json()).sessionId, "requested-session");
});

test("forwards project health and file search requests", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  const forwarded: Array<{ projectId: string; path: string; query: string }> = [];
  const sessionRouter = {
    projectRequest: async (
      projectId: string,
      path: string,
      query: string,
    ) => {
      forwarded.push({ projectId, path, query });
      return Response.json({ ok: true });
    },
  } as unknown as ProjectSessionRouter;
  const daemon = await startDaemonServer({
    projectStore: store,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = { authorization: `Bearer ${token}` };

  const health = await fetch(
    `${daemon.url}/projects/${project.id}/health`,
    { headers },
  );
  const files = await fetch(
    `${daemon.url}/projects/${project.id}/files?query=readme&limit=5`,
    { headers },
  );

  assert.equal(health.status, 200);
  assert.equal(files.status, 200);
  assert.deepEqual(forwarded, [
    { projectId: project.id, path: "health", query: "" },
    {
      projectId: project.id,
      path: "files",
      query: "?query=readme&limit=5",
    },
  ]);
});

test("forwards project session state, messages, and actions", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  const forwarded: Array<{
    projectId: string;
    sessionId: string;
    method: string;
    path: string;
    body?: string;
  }> = [];
  const sessionRouter = {
    request: async (
      projectId: string,
      sessionId: string,
      request: {
        method: string;
        path: string;
        body?: string;
      },
    ) => {
      forwarded.push({
        projectId,
        sessionId,
        method: request.method,
        path: request.path,
        body: request.body,
      });
      return Response.json({ ok: true });
    },
  } as unknown as ProjectSessionRouter;
  const daemon = await startDaemonServer({
    projectStore: store,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const base =
    `${daemon.url}/projects/${project.id}/sessions/session-one`;

  for (const path of ["state", "messages"]) {
    const response = await fetch(`${base}/${path}`, { headers });
    assert.equal(response.status, 200);
  }
  const actionResponse = await fetch(`${base}/action/status`, {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(actionResponse.status, 200);
  const steerBody = JSON.stringify({
    message: "x".repeat(70 * 1024),
    attachments: [],
  });
  const steerResponse = await fetch(`${base}/action/steer_current_turn`, {
    method: "POST",
    headers,
    body: steerBody,
  });
  assert.equal(steerResponse.status, 200);
  assert.deepEqual(forwarded, [
    {
      projectId: project.id,
      sessionId: "session-one",
      method: "GET",
      path: "state",
      body: undefined,
    },
    {
      projectId: project.id,
      sessionId: "session-one",
      method: "GET",
      path: "messages",
      body: undefined,
    },
    {
      projectId: project.id,
      sessionId: "session-one",
      method: "POST",
      path: "action/status",
      body: "{}",
    },
    {
      projectId: project.id,
      sessionId: "session-one",
      method: "POST",
      path: "action/steer_current_turn",
      body: steerBody,
    },
  ]);
});

test("streams chat and events without buffering", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  const forwarded: Array<{ path: string; body?: string }> = [];
  const sessionRouter = {
    request: async (
      _projectId: string,
      _sessionId: string,
      request: { path: string; body?: string },
    ) => {
      forwarded.push({ path: request.path, body: request.body });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: first\n\n"));
            controller.enqueue(new TextEncoder().encode("data: second\n\n"));
            controller.close();
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          },
        },
      );
    },
  } as unknown as ProjectSessionRouter;
  const daemon = await startDaemonServer({
    projectStore: store,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const base =
    `${daemon.url}/projects/${project.id}/sessions/session-one`;

  const largeMessage = "x".repeat(70 * 1024);
  const chatBody = JSON.stringify({
    message: largeMessage,
    attachments: [],
  });
  const chatResponse = await fetch(`${base}/chat?stream=true`, {
    method: "POST",
    headers,
    body: chatBody,
  });
  assert.equal(chatResponse.headers.get("content-type"), "text/event-stream");
  assert.equal(
    await chatResponse.text(),
    "data: first\n\ndata: second\n\n",
  );

  const eventsResponse = await fetch(`${base}/events`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(
    await eventsResponse.text(),
    "data: first\n\ndata: second\n\n",
  );
  assert.deepEqual(forwarded, [
    {
      path: "chat",
      body: chatBody,
    },
    {
      path: "events",
      body: undefined,
    },
  ]);
});

test("aborts the upstream event stream when the client disconnects", async (t) => {
  const fixture = await createFixture();
  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath);
  let upstreamSignal: AbortSignal | undefined;
  const sessionRouter = {
    request: async (
      _projectId: string,
      _sessionId: string,
      request: { signal?: AbortSignal },
    ) => {
      upstreamSignal = request.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  } as unknown as ProjectSessionRouter;
  const daemon = await startDaemonServer({
    projectStore: store,
    sessionRouter,
    authToken: token,
  });
  t.after(() => daemon.close());

  await new Promise<void>((resolve, reject) => {
    const request = httpGet(
      `${daemon.url}/projects/${project.id}/sessions/session-one/events`,
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      (response) => {
        response.once("data", () => {
          request.destroy();
          resolve();
        });
      },
    );
    request.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
  });
  await waitFor(() => upstreamSignal?.aborted === true);
  assert.equal(upstreamSignal?.aborted, true);
});

test("commits and pushes a registered project workspace through the daemon", async (t) => {
  const fixture = await createFixture();
  const remotePath = path.join(path.dirname(fixture.workspacePath), "remote.git");
  await git(["init", "--bare", remotePath]);
  await git(["init"], fixture.workspacePath);
  await git(["config", "user.name", "Chump Test"], fixture.workspacePath);
  await git(["config", "user.email", "chump@example.test"], fixture.workspacePath);
  await git(["remote", "add", "origin", remotePath], fixture.workspacePath);
  await mkdir(path.join(fixture.workspacePath, "src"));
  await writeFile(path.join(fixture.workspacePath, "src", "app.txt"), "hello\n");

  const token = "test-token-that-is-long-enough-for-auth";
  const store = new ProjectRegistryStore({
    registryPath: fixture.registryPath,
  });
  const project = await store.register(fixture.workspacePath, "Example");
  const daemon = await startDaemonServer({
    projectStore: store,
    authToken: token,
  });
  t.after(() => daemon.close());

  const response = await fetch(`${daemon.url}/projects/${project.id}/git/commit-push`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message: "Initial commit", files: ["src/app.txt"] }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; message: string };
  assert.equal(body.ok, true);
  assert.match(body.message, /main|master|Initial commit|Committed and pushed/u);

  const { stdout } = await git(["branch", "--list"], remotePath);
  assert.match(stdout, /main|master/u);
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

async function git(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", args, { cwd });
}

function runtimeMetadata(workspaceRoot: string) {
  return {
    url: "http://127.0.0.1:9000",
    port: 9000,
    pid: 123,
    command: "server",
    command_args: [],
    command_source: "local" as const,
    workspace_root: workspaceRoot,
    data_dir: "/tmp/chump",
    log_path: "/tmp/chump/server.log",
    started_at: "2026-06-13T00:00:00.000Z",
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
