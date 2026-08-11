import assert from "node:assert/strict";
import test from "node:test";

import {
  getAllSessions,
  getSessionSnapshot,
  getSessions,
  streamChat,
} from "./http.ts";
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

test("hydrates a session through one invocation-owned snapshot", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestUrl = String(input);
    return Response.json({
      status: { agent_id: "session-1", turn_running: true },
      messages: [],
      events: [],
    });
  }) as typeof fetch;

  try {
    const snapshot = await getSessionSnapshot(config);
    assert.equal(snapshot.status.turn_running, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    requestUrl,
    "http://server.test/agent/session-1/session-snapshot",
  );
});

test("falls back to established hydration endpoints when snapshot is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const requestUrls: string[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    requestUrls.push(url);
    if (url.endsWith("/session-snapshot")) {
      return new Response("404: Not Found", { status: 404 });
    }
    if (url.endsWith("/action/status")) {
      return Response.json({
        result: { agent_id: "session-1", turn_running: false },
      });
    }
    if (url.endsWith("/messages")) {
      return Response.json({ messages: [{ role: "user", content: "hello" }] });
    }
    if (url.endsWith("/action/event_log")) {
      assert.equal(init?.method, "POST");
      return Response.json({
        result: {
          events: [{ id: 1, type: "user_message", data: { content: "hello" } }],
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const snapshot = await getSessionSnapshot(config);
    assert.equal(snapshot.status.agent_id, "session-1");
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.events.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestUrls, [
    "http://server.test/agent/session-1/session-snapshot",
    "http://server.test/agent/session-1/action/status",
    "http://server.test/agent/session-1/messages",
    "http://server.test/agent/session-1/action/event_log",
  ]);
});

test("loads every six-item session page only when requested", async () => {
  const originalFetch = globalThis.fetch;
  const requestedPages: number[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    requestedPages.push(page);
    return Response.json({
      sessions: [{
        id: `session-${page}`,
        active: false,
        message_count: 0,
        event_count: 0,
        title: `Session ${page}`,
        created_at: page,
        updated_at: page,
        last_user_goal: null,
        last_activity: null,
        connections: 0,
      }],
      page,
      page_size: 6,
      total: 18,
      total_pages: 3,
    });
  }) as typeof fetch;

  try {
    const sessions = await getAllSessions(config);
    assert.deepEqual(sessions.map((session) => session.id), [
      "session-1",
      "session-2",
      "session-3",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestedPages, [1, 2, 3]);
});

test("never loads or returns more than sixty session suggestions", async () => {
  const originalFetch = globalThis.fetch;
  const requestedPages: number[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    requestedPages.push(page);
    const offset = (page - 1) * 6;
    return Response.json({
      sessions: Array.from({ length: 6 }, (_, index) => ({
        id: `session-${offset + index + 1}`,
        active: false,
        message_count: 0,
        event_count: 0,
        title: null,
        created_at: null,
        updated_at: null,
        last_user_goal: null,
        last_activity: null,
        connections: 0,
      })),
      page,
      page_size: 6,
      total: 600,
      total_pages: 100,
    });
  }) as typeof fetch;

  try {
    const sessions = await getAllSessions(config);
    assert.equal(sessions.length, 60);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
