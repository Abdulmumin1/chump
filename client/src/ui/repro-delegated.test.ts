// High-fidelity reproduction: feed the exact SSE event sequence the chump
// server emits for a delegated start_session run (verified by
// server/tests/test_delegated_turn_e2e.py) through the client pipeline
// (transcriptEventFromSse -> TranscriptRenderer) and assert the transcript.
import { test } from "node:test";
import assert from "node:assert/strict";

import { TranscriptRenderer, transcriptEventFromSse } from "./transcript.ts";
import type { SseEvent } from "../core/types.ts";

function sse(event: string, data: unknown, id?: number): SseEvent {
  return {
    event,
    data: JSON.stringify(data),
    ...(id !== undefined ? { id: String(id) } : {}),
  };
}

const STEP = 1;
const INDEX = 0;
const CALL_ID = "call-start-1";

const callStarted = {
  step: STEP,
  index: INDEX,
  call_id: CALL_ID,
  name: "start_session",
};
const callDelta = {
  step: STEP,
  index: INDEX,
  call_id: CALL_ID,
  name_delta: null,
  arguments_delta: '{"prompt":"Do the delegated work","session_id":"child-session"}',
};
const callReady = {
  schema_version: 1,
  tool: "start_session",
  name: "start_session",
  payload: { prompt: "Do the delegated work", session_id: "child-session" },
  args: { prompt: "Do the delegated work", session_id: "child-session" },
  id: CALL_ID,
  call_id: CALL_ID,
  tool_call_id: CALL_ID,
  step: STEP,
  index: INDEX,
  status: "ready",
};
const executionStarted = {
  step: STEP,
  index: INDEX,
  tool: "start_session",
  call_id: CALL_ID,
  tool_call_id: CALL_ID,
  name: "start_session",
};
const progress = (childEvent: Record<string, unknown>): unknown => ({
  step: STEP,
  index: INDEX,
  tool: "start_session",
  call_id: CALL_ID,
  tool_call_id: CALL_ID,
  name: "start_session",
  message: "Delegated session progress",
  data: { kind: "delegated_session", session_id: "child-session", event: childEvent },
});
const executionFinished = {
  step: STEP,
  index: INDEX,
  tool: "start_session",
  call_id: CALL_ID,
  tool_call_id: CALL_ID,
  name: "start_session",
  duration: 5.2,
  error: null,
  aborted: false,
  ok: true,
  status: "ok",
  preview: '{"session_id":"child-session","response":"Child final answer."}',
  metadata: {},
  display_output: "",
};
const toolResult = {
  schema_version: 1,
  tool: "start_session",
  name: "start_session",
  tool_name: "start_session",
  id: CALL_ID,
  call_id: CALL_ID,
  tool_call_id: CALL_ID,
  step: STEP,
  index: INDEX,
  ok: true,
  status: "ok",
  preview: '{"session_id":"child-session","response":"Child final answer."}',
  metadata: {},
  duration: 5.2,
  display_output: "",
};

test("delegated start_session run renders call and result in real server order", () => {
  const lines: string[] = [];
  const delegatedProgressSeen: unknown[] = [];
  const renderer = new TranscriptRenderer({
    workspaceRoot: "/workspace",
    hooks: {
      onToolActivity: () => {},
      onToolResult: () => {},
      onDelegatedSessionProgress: (p) => delegatedProgressSeen.push(p),
    },
  });
  const toolActivityRenderer = (renderer as unknown as {
    toolActivityRenderer: {
      writeLine: (v?: string) => void;
      writeCommandActivity: ((a: { command: string }) => boolean) | null;
      writeCompactActivity: ((a: { fallbackLine: string }) => boolean) | null;
    };
  }).toolActivityRenderer;
  toolActivityRenderer.writeLine = (value = "") => lines.push(value);
  toolActivityRenderer.writeCommandActivity = (activity) => {
    lines.push(`CMD: ${activity.command}`);
    return true;
  };
  toolActivityRenderer.writeCompactActivity = (activity) => {
    lines.push(activity.fallbackLine);
    return true;
  };

  const events = [
    sse("tool_call.started", callStarted, 10),
    sse("tool_call.delta", callDelta, 11),
    sse("tool_call", callReady, 12),
    sse("tool_execution.started", executionStarted, 13),
    sse("tool_execution.progress", progress({ type: "session_starting" }), 14),
    sse("tool_execution.progress", progress({ type: "reasoning", text: "analyzing" }), 15),
    sse("tool_execution.progress", progress({ type: "tool_call", name: "bash", call_id: "child-call-1", args: { command: "ls" } }), 16),
    sse("tool_execution.progress", progress({ type: "tool_result", name: "bash", call_id: "child-call-1", status: "ok" }), 17),
    sse("tool_execution.progress", progress({ type: "assistant_text" }), 18),
    sse("tool_execution.finished", executionFinished, 19),
    sse("tool_result", toolResult, 20),
  ];

  for (const event of events) {
    const transcriptEvent = transcriptEventFromSse(event);
    // tool_execution.started is intentionally not surfaced to the transcript.
    if (transcriptEvent) {
      renderer.render(transcriptEvent);
    }
  }

  console.log("OUTPUT LINES (json):\n" + JSON.stringify(lines, null, 1));
  console.log("DELEGATED PROGRESS COUNT: " + delegatedProgressSeen.length);

  const joined = lines.join("\n");
  assert.ok(joined.includes("Session"), "expected a completed session row");
  assert.ok(!joined.includes("Start session"), "expected the completed semantic label");
  assert.ok(joined.includes("Child final answer"), "expected the delegated result");
  assert.equal(delegatedProgressSeen.length, 5, "expected all child progress forwarded");
});
