import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDelegatedSessionProgress } from "./delegated-session-progress.ts";

test("parses a correlated delegated child tool event", () => {
  assert.deepEqual(
    parseDelegatedSessionProgress({
      step: 2,
      index: 1,
      call_id: "parent-call",
      data: {
        kind: "delegated_session",
        session_id: "inspect-api",
        event: {
          type: "tool_call",
          name: "read_file",
          call_id: "child-call",
          args: { path: "server/chump_server/agent.py" },
        },
      },
    }),
    {
      parentCallId: "parent-call",
      parentStep: 2,
      parentIndex: 1,
      sessionId: "inspect-api",
      event: {
        type: "tool_call",
        name: "read_file",
        callId: "child-call",
        args: { path: "server/chump_server/agent.py" },
      },
    },
  );
});

test("rejects unrelated or malformed tool progress", () => {
  assert.equal(parseDelegatedSessionProgress({ data: { kind: "download" } }), null);
  assert.equal(
    parseDelegatedSessionProgress({
      step: 1,
      index: 0,
      call_id: "parent-call",
      data: {
        kind: "delegated_session",
        session_id: "inspect-api",
        event: { type: "tool_call", name: "read_file", args: {} },
      },
    }),
    null,
  );
});
