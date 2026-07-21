import assert from "node:assert/strict";
import test from "node:test";

import { getSessions, streamChat } from "./http.ts";
import { ServerStreamInterruptedError } from "./errors.ts";
import type { ChumpConfig } from "../core/types.ts";
import { ManagedServerRequestCoordinator } from "../app/managed-recovery.ts";

const config: ChumpConfig = {
  agentId: "session-1",
  serverUrl: "http://server.test",
  serverSource: "managed",
  workspaceRoot: "/workspace",
};

test("requests six sessions by default", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestUrl = String(input);
    return new Response(JSON.stringify({
      sessions: [],
      page: 1,
      page_size: 6,
      total: 0,
      total_pages: 1,
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await getSessions(config);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(new URL(requestUrl).searchParams.get("limit"), "6");
});

test("treats a chat response that closes without end as a transport interruption", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('event: start\ndata: null\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;

  try {
    await assert.rejects(
      streamChat(config, "hello"),
      ServerStreamInterruptedError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replays an interrupted prompt once against the recovered target", async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestUrls.push(String(input));
    if (requestUrls.length === 1) {
      return new Response('event: start\ndata: null\n\n', { status: 200 });
    }
    return new Response(
      'event: start\ndata: null\n\nevent: end\ndata: "delivered"\n\n',
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const current = { ...config };
  const coordinator = new ManagedServerRequestCoordinator(
    () => current,
    async () => {
      current.serverUrl = "http://recovered.test";
    },
  );
  let response = "";

  try {
    await coordinator.run(current, (requestConfig) =>
      streamChat(requestConfig, "hello", [], {
        onEnd: (text) => {
          response = text;
        },
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response, "delivered");
  assert.equal(requestUrls.length, 2);
  assert.equal(new URL(requestUrls[0]).host, "server.test");
  assert.equal(new URL(requestUrls[1]).host, "recovered.test");
});
