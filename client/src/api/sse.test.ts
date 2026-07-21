import assert from "node:assert/strict";
import { test } from "node:test";

import { openEventStream } from "./sse.ts";

test("event replay resumes after the last applied ID without duplicates", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  const bodies = [
    sseEvents(1, 2),
    sseEvents(1, 2),
    sseEvents(2, 3, 4),
  ];
  let responseIndex = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(new URL(String(input)));
    return new Response(bodies[responseIndex++], {
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  const applied: number[] = [];
  let failSecondEvent = true;
  let errors = 0;
  let close = () => {};
  let finish: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  try {
    close = await openEventStream(
      {
        agentId: "replay-test",
        serverUrl: "http://127.0.0.1:8000",
        serverSource: "direct",
        workspaceRoot: "/tmp/replay-test",
      },
      {
        onEvent: async (event) => {
          const id = Number(event.id);
          if (id === 2 && failSecondEvent) {
            failSecondEvent = false;
            throw new Error("apply failed");
          }
          await Promise.resolve();
          applied.push(id);
          if (id === 4) {
            close();
            finish();
          }
        },
        onError: () => {
          errors += 1;
        },
      },
      { reconnectDelayMs: 0, maxReconnectDelayMs: 0 },
    );

    await Promise.race([
      finished,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("event replay timed out")), 1_000),
      ),
    ]);

    assert.deepEqual(applied, [1, 2, 3, 4]);
    assert.equal(errors, 1);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].searchParams.get("last_event_id"), null);
    assert.equal(requests[1].searchParams.get("last_event_id"), "1");
    assert.equal(requests[2].searchParams.get("last_event_id"), "2");
  } finally {
    close();
    globalThis.fetch = originalFetch;
  }
});

function sseEvents(...ids: number[]): string {
  return ids
    .map((id) => `id: ${id}\nevent: status\ndata: {"seq":${id}}\n\n`)
    .join("");
}
