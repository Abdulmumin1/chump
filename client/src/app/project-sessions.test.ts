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

  assert.deepEqual(await router.list("project-one"), {
    projectId: "project-one",
    sessions: [session("session-one")],
  });
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1/project-one/sessions",
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
