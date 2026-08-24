import assert from "node:assert/strict";
import test from "node:test";

import {
  getAllSessions,
  getSessions,
  streamChat,
} from "./http.ts";
import { ServerStreamInterruptedError } from "./errors.ts";
import type { ChumpConfig } from "../core/types.ts";

const config: ChumpConfig = {
  agentId: "session-1",
  serverUrl: "http://server.test",
  apiTarget: { kind: "direct" },
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
test("scopes and authenticates shared-service requests", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let authorization = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({
      sessions: [],
      page: 1,
      page_size: 6,
      total: 0,
      total_pages: 1,
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await getSessions({
      ...config,
      apiTarget: {
        kind: "service",
        projectId: "project one",
        token: "service-secret",
      },
    });
    assert.equal(
      requestUrl,
      "http://server.test/projects/project%20one/sessions?page=1&limit=6",
    );
    assert.equal(authorization, "Bearer service-secret");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
