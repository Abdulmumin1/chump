import assert from "node:assert/strict";
import test from "node:test";

import { ProjectSessionRouter } from "./project-sessions.ts";
import type { ProjectRuntimeSupervisor } from "./project-runtime.ts";

test("lists sessions from only the selected project runtime", async () => {
  const requestedUrls: string[] = [];
  const runtimes = {
    start: async (projectId: string) => ({
      projectId,
      status: "running",
      serverUrl: `http://127.0.0.1/${projectId}`,
      pid: 123,
    }),
  } as ProjectRuntimeSupervisor;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async (input) => {
      requestedUrls.push(String(input));
      return Response.json({
        sessions: [session("session-one")],
      });
    },
  });

  assert.deepEqual(await router.list("project-one", "?page=2&limit=15"), {
    projectId: "project-one",
    sessions: [session("session-one")],
    page: 1,
    page_size: 1,
    total: 1,
    total_pages: 1,
  });
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1/project-one/sessions?page=2&limit=15",
  ]);
});

test("returns null for unknown projects and rejects invalid runtime responses", async () => {
  const missingRuntimes = {
    start: async () => null,
  } as unknown as ProjectRuntimeSupervisor;
  assert.equal(
    await new ProjectSessionRouter(missingRuntimes).list("missing"),
    null,
  );

  const runningRuntimes = {
    start: async () => ({
      projectId: "project-one",
      status: "running",
      serverUrl: "http://127.0.0.1:9000",
      pid: 123,
    }),
  } as unknown as ProjectRuntimeSupervisor;
  await assert.rejects(
    new ProjectSessionRouter(runningRuntimes, {
      fetch: async () => Response.json({ sessions: [{}] }),
    }).list("project-one"),
    /response is invalid/,
  );
});

test("forwards session requests only to the selected project runtime", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const runtimes = {
    start: async (projectId: string) => ({
      projectId,
      status: "running",
      serverUrl: `http://127.0.0.1/${projectId}`,
      pid: 123,
    }),
  } as unknown as ProjectRuntimeSupervisor;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({ state: { workspace_root: "/workspace" } });
    },
  });

  const response = await router.request("project-one", "session/one", {
    method: "GET",
    path: "state",
    query: "?detail=full",
  });

  assert.equal(response?.status, 200);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1/project-one/agent/session%2Fone/state?detail=full",
  );
  assert.equal(requests[0]?.init?.method, "GET");
});

test("forwards atomic session snapshots to the selected project runtime", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const runtimes = {
    start: async (projectId: string) => ({
      projectId,
      status: "running",
      serverUrl: `http://127.0.0.1/${projectId}`,
      pid: 123,
    }),
  } as unknown as ProjectRuntimeSupervisor;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({ status: {}, messages: [], events: [] });
    },
  });

  const response = await router.request("project-one", "session-one", {
    method: "GET",
    path: "session-snapshot",
  });

  assert.equal(response?.status, 200);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1/project-one/agent/session-one/session-snapshot",
  );
  assert.equal(requests[0]?.init?.method, "GET");
});

test("retries safe session reads after a managed runtime exits", async () => {
  let starts = 0;
  const runtimes = {
    start: async (projectId: string) => {
      starts += 1;
      return {
        projectId,
        status: "running",
        serverUrl: starts === 1
          ? "http://127.0.0.1:9001"
          : "http://127.0.0.1:9002",
        pid: starts,
      };
    },
  } as unknown as ProjectRuntimeSupervisor;
  const requested: string[] = [];
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async (input) => {
      requested.push(String(input));
      if (requested.length === 1) throw new TypeError("fetch failed");
      return Response.json({ messages: [] });
    },
  });

  const response = await router.request("project-one", "session-one", {
    method: "GET",
    path: "messages",
  });

  assert.equal(response?.status, 200);
  assert.deepEqual(requested, [
    "http://127.0.0.1:9001/agent/session-one/messages",
    "http://127.0.0.1:9002/agent/session-one/messages",
  ]);
});

test("does not replay chat writes after an ambiguous managed runtime failure", async () => {
  let starts = 0;
  const runtimes = {
    start: async (projectId: string) => {
      starts += 1;
      return {
        projectId,
        status: "running",
        serverUrl: "http://127.0.0.1:9001",
        pid: 1,
      };
    },
  } as unknown as ProjectRuntimeSupervisor;
  let requests = 0;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async () => {
      requests += 1;
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    router.request("project-one", "session-one", {
      method: "POST",
      path: "chat",
      body: "{}",
    }),
    /fetch failed/,
  );
  assert.equal(starts, 1);
  assert.equal(requests, 1);
});

test("does not retry an interrupted event stream as a complete request", async () => {
  let starts = 0;
  const runtimes = {
    start: async (projectId: string) => {
      starts += 1;
      return {
        projectId,
        status: "running",
        serverUrl: "http://127.0.0.1:9001",
        pid: 1,
      };
    },
  } as unknown as ProjectRuntimeSupervisor;
  let requests = 0;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async () => {
      requests += 1;
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    router.request("project-one", "session-one", {
      method: "GET",
      path: "events",
    }),
    /fetch failed/,
  );
  assert.equal(starts, 1);
  assert.equal(requests, 1);
});

test("does not retry safe reads when the runtime supervisor returns the same server", async () => {
  let starts = 0;
  const runtimes = {
    start: async (projectId: string) => {
      starts += 1;
      return {
        projectId,
        status: "running",
        serverUrl: "http://127.0.0.1:9001",
        pid: 1,
      };
    },
  } as unknown as ProjectRuntimeSupervisor;
  let requests = 0;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async () => {
      requests += 1;
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    router.request("project-one", "session-one", {
      method: "GET",
      path: "messages",
    }),
    /fetch failed/,
  );
  assert.equal(starts, 2);
  assert.equal(requests, 1);
});

test("forwards project health and file searches to the selected runtime", async () => {
  const requested: string[] = [];
  const runtimes = {
    start: async () => ({
      projectId: "project-one",
      status: "running",
      serverUrl: "http://127.0.0.1:9000",
      pid: 123,
    }),
  } as unknown as ProjectRuntimeSupervisor;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async (input) => {
      requested.push(String(input));
      return Response.json({ ok: true });
    },
  });

  await router.projectRequest("project-one", "health");
  await router.projectRequest("project-one", "files", "?query=readme&limit=5");

  assert.deepEqual(requested, [
    "http://127.0.0.1:9000/health",
    "http://127.0.0.1:9000/files?query=readme&limit=5",
  ]);
});

test("creates validated project-scoped session handles", async () => {
  const runtimes = {
    start: async (projectId: string) => ({
      projectId,
      status: "running",
      serverUrl: "http://127.0.0.1:9000",
      pid: 123,
    }),
  } as unknown as ProjectRuntimeSupervisor;
  const router = new ProjectSessionRouter(runtimes, {
    fetch: async () => Response.json({
      sessions: [session("existing-session")],
    }),
  });

  assert.deepEqual(await router.create("project-one", "new-session"), {
    projectId: "project-one",
    sessionId: "new-session",
  });
  assert.match(
    (await router.create("project-one"))?.sessionId ?? "",
    /^session-one-[a-z0-9]+-[a-f0-9]{8}$/,
  );
  await assert.rejects(
    router.create("project-one", "bad/session"),
    /sessionId must contain only/,
  );
  await assert.rejects(
    router.create("project-one", "existing-session"),
    /session already exists/,
  );
});

function session(id: string) {
  return {
    id,
    active: false,
    message_count: 1,
    event_count: 2,
    title: null,
    created_at: 1,
    updated_at: 2,
    last_user_goal: null,
    last_activity: null,
    connections: 0,
  };
}
