import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRemoteTurnHydration } from "./remote-turn-hydration.ts";
import type { ChumpStatus, StoredEvent } from "./types.ts";

test("event-log turn state wins the race with stale status at its replay cursor", () => {
  const hydration = resolveRemoteTurnHydration(
    status({ turn_running: false }),
    [
      event(10, "turn_status", { running: true, steering_queue: [] }),
      event(11, "reasoning", { text: "Inspecting lifecycle boundaries" }),
      event(12, "tool_execution.progress", {
        call_id: "parent-call",
        step: 1,
        index: 0,
        data: {
          kind: "delegated_session",
          session_id: "child-session",
          event: { type: "reasoning", text: "Inspecting child work" },
        },
      }),
      event(13, "assistant_text", { content: "raw partial response" }),
    ],
  );

  assert.equal(hydration.running, true);
  assert.equal(hydration.lastEventId, 13);
  assert.deepEqual(hydration.activityEvents, [
    event(11, "reasoning", { text: "Inspecting lifecycle boundaries" }),
    event(12, "tool_execution.progress", {
      call_id: "parent-call",
      step: 1,
      index: 0,
      data: {
        kind: "delegated_session",
        session_id: "child-session",
        event: { type: "reasoning", text: "Inspecting child work" },
      },
    }),
    event(13, "assistant_text", { content: "raw partial response" }),
  ]);
});

test("completed event-log turn clears stale running status before cursor advance", () => {
  const hydration = resolveRemoteTurnHydration(
    status({ turn_running: true }),
    [
      event(20, "turn_status", { running: true, steering_queue: [] }),
      event(21, "assistant_text", { content: "Done." }),
      event(22, "turn_status", { running: false, steering_queue: [] }),
    ],
  );

  assert.equal(hydration.running, false);
  assert.deepEqual(hydration.activityEvents, []);
  assert.equal(hydration.lastEventId, 22);
});

function status(overrides: Partial<ChumpStatus>): ChumpStatus {
  return {
    agent_id: "child",
    workspace_root: "/workspace",
    provider: "faux",
    model: "faux-1",
    max_steps: 4,
    command_timeout: 30,
    managed_idle_timeout: null,
    reasoning: null,
    verbose: false,
    message_count: 1,
    title: null,
    created_at: null,
    updated_at: null,
    last_user_goal: null,
    instruction_files: [],
    skills: [],
    ...overrides,
  };
}

function event(
  id: number,
  type: string,
  data: Record<string, unknown>,
): StoredEvent {
  return { id, type, data };
}
