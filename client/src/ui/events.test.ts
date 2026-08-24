import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { test } from "node:test";

import type { ChumpConfig } from "../core/types.ts";
import {
  setAgentStatusHook,
  startEventStream,
} from "./events.ts";

test("a superseded event stream cannot update session UI state or its replay cursor", async () => {
  let resolveFirstResponse: ((response: ServerResponse) => void) | null = null;
  let resolveSecondResponse:
    | ((connection: { response: ServerResponse; url: string }) => void)
    | null = null;
  const firstResponsePromise = new Promise<ServerResponse>((resolve) => {
    resolveFirstResponse = resolve;
  });
  const secondResponsePromise = new Promise<{
    response: ServerResponse;
    url: string;
  }>((resolve) => {
    resolveSecondResponse = resolve;
  });

  const server = createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");

    if (request.url?.startsWith("/agent/first-session/events")) {
      resolveFirstResponse?.(response);
      return;
    }
    if (request.url?.startsWith("/agent/second-session/events")) {
      resolveSecondResponse?.({ response, url: request.url });
      return;
    }
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  const baseConfig: ChumpConfig = {
    agentId: "first-session",
    serverUrl: `http://127.0.0.1:${address.port}`,
    apiTarget: { kind: "direct" },
    workspaceRoot: process.cwd(),
  };
  const statuses: string[] = [];
  const firstEventIds: number[] = [];
  const secondEventIds: number[] = [];
  setAgentStatusHook((payload) => {
    if (typeof payload.agent_id === "string") {
      statuses.push(payload.agent_id);
    }
  });

  let closeFirst: (() => void) | null = null;
  let closeSecond: (() => void) | null = null;
  try {
    closeFirst = await startEventStream(baseConfig, {
      onLastEventId: (eventId) => firstEventIds.push(eventId),
    });
    const firstResponse = await firstResponsePromise;

    closeSecond = await startEventStream(
      { ...baseConfig, agentId: "second-session" },
      {
        lastEventId: 37,
        onLastEventId: (eventId) => secondEventIds.push(eventId),
      },
    );
    const secondConnection = await secondResponsePromise;
    assert.equal(
      new URL(secondConnection.url, baseConfig.serverUrl).searchParams.get(
        "last_event_id",
      ),
      "37",
    );

    firstResponse.write(agentStatusEvent(11, "first-session"));
    await nextEventLoopTurn();
    assert.deepEqual(statuses, []);
    assert.deepEqual(firstEventIds, []);

    secondConnection.response.write(agentStatusEvent(38, "second-session"));
    await waitFor(() => statuses.length === 1);
    assert.deepEqual(statuses, ["second-session"]);
    assert.deepEqual(secondEventIds, [38]);
  } finally {
    closeSecond?.();
    closeFirst?.();
    setAgentStatusHook(null);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

function agentStatusEvent(id: number, agentId: string): string {
  return [
    `id: ${id}`,
    "event: agent_status",
    `data: ${JSON.stringify({
      schema_version: 1,
      agent_id: agentId,
      provider: "faux",
      model: "faux-1",
    })}`,
    "",
    "",
  ].join("\n");
}

async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for SSE event");
    }
    await nextEventLoopTurn();
  }
}
