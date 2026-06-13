import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureDaemonProjectTarget,
  type DaemonClientDependencies,
} from "./daemon-client.ts";
import { createDaemonMetadata } from "./daemon-metadata.ts";

test("registers a workspace and starts its runtime through the daemon", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let ensured = false;
  const dependencies: DaemonClientDependencies = {
    ensureDaemon: async () => {
      ensured = true;
    },
    readMetadata: async () => createDaemonMetadata(123, 5740),
    readToken: async () => "test-token",
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/projects")) {
        return Response.json({
          project: {
            id: "project-1",
            name: "workspace",
            workspacePath: "/workspace",
            createdAt: 1,
            lastOpenedAt: 1,
            status: "ready",
          },
        }, { status: 201 });
      }
      return Response.json({
        runtime: {
          projectId: "project-1",
          status: "running",
          serverUrl: "http://127.0.0.1:9000",
          pid: 456,
        },
      });
    },
  };

  const target = await ensureDaemonProjectTarget("/workspace", dependencies);

  assert.equal(ensured, true);
  assert.equal(target.project.id, "project-1");
  assert.equal(target.runtime.serverUrl, "http://127.0.0.1:9000");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("authorization"),
    "Bearer test-token",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    workspacePath: "/workspace",
    approved: true,
  });
});

test("fails closed when daemon discovery or responses are invalid", async () => {
  await assert.rejects(
    ensureDaemonProjectTarget("/workspace", {
      ensureDaemon: async () => undefined,
      readMetadata: async () => null,
      readToken: async () => "token",
    }),
    /metadata is unavailable/,
  );

  await assert.rejects(
    ensureDaemonProjectTarget("/workspace", {
      ensureDaemon: async () => undefined,
      readMetadata: async () => createDaemonMetadata(123, 5740),
      readToken: async () => "token",
      fetch: async () => Response.json(
        { error: "invalid_request", message: "rejected" },
        { status: 400 },
      ),
    }),
    /failed to register project through daemon \(400\): rejected/,
  );
});
