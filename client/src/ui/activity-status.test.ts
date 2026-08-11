import assert from "node:assert/strict";
import { test } from "node:test";

import { createActivityStatusController } from "./activity-status.ts";
import type { StatusDisplay } from "./status.ts";

const ANSI = /\x1b\[[0-9;]*m/g;

function visible(status: StatusDisplay): string[] {
  const lines = status === null
    ? []
    : typeof status === "string"
      ? [status]
      : [...status];
  return lines.map((line) => line.replace(ANSI, ""));
}

function call(index: number): Record<string, unknown> {
  return { step: 1, index, call_id: `call_${index}` };
}

test("keeps parallel tool rows stable until the whole batch completes", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController((status) => statuses.push(status));
  controller.start();

  controller.noteToolActivity("Reading first.ts", call(0));
  controller.noteToolActivity("Searching second.ts", call(1));

  assert.deepEqual(
    visible(statuses.at(-1) ?? null).slice(1),
    ["├─ ◐ Reading first.ts", "└─ ◐ Searching second.ts"],
  );

  controller.noteToolResult({ ...call(1), status: "ok" });
  const afterSecond = visible(statuses.at(-1) ?? null);
  assert.match(afterSecond[0] ?? "", /1 tool running · 1 done/);
  assert.deepEqual(
    afterSecond.slice(1),
    ["├─ ◐ Reading first.ts", "└─ ✓ Searching second.ts"],
  );

  controller.noteToolResult({ ...call(0), status: "ok" });
  const settled = visible(statuses.at(-1) ?? null);
  assert.equal(settled.length, 1);
  assert.match(settled[0] ?? "", /Thinking/);

  controller.stop();
});

test("rehydrates running activity without exposing replayed assistant text", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController(
    (status) => statuses.push(status),
    { workspaceRoot: "/workspace" },
  );
  controller.start();
  controller.rehydrate([
    {
      id: 1,
      type: "assistant_text",
      data: { content: "raw partial response" },
    },
    {
      id: 2,
      type: "tool_call",
      data: {
        name: "read_file",
        call_id: "read-active-file",
        args: { path: "/workspace/server/chump_server/agent.py" },
        step: 1,
        index: 0,
      },
    },
  ]);

  const current = visible(statuses.at(-1) ?? null);
  assert.match(current[0] ?? "", /1 tool running/);
  assert.match(current[1] ?? "", /Reading file server\/chump_server\/agent\.py/);
  assert.doesNotMatch(current.join("\n"), /raw partial response/);

  controller.stop();
});

test("a result only updates its correlated parallel tool", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController((status) => statuses.push(status));
  controller.start();
  controller.noteToolActivity("Reading first.ts", call(0));
  controller.noteToolActivity("Reading second.ts", call(1));

  controller.noteToolResult({ ...call(9), status: "ok" });
  const afterUnknownResult = visible(statuses.at(-1) ?? null);
  assert.match(afterUnknownResult[0] ?? "", /2 tools running/);
  assert.match(afterUnknownResult[1] ?? "", /Reading first\.ts/);
  assert.match(afterUnknownResult[2] ?? "", /Reading second\.ts/);

  controller.noteToolResult({ ...call(0), status: "error" });
  const afterFailure = visible(statuses.at(-1) ?? null);
  assert.match(afterFailure[0] ?? "", /1 tool running · 1 failed/);
  assert.match(afterFailure[1] ?? "", /× Reading first\.ts/);
  assert.doesNotMatch(afterFailure[1] ?? "", /\[error\]/);
  assert.match(afterFailure[2] ?? "", /◐ Reading second\.ts/);

  controller.stop();
});

test("streaming argument updates replace their row instead of adding one", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController((status) => statuses.push(status));
  controller.start();

  controller.noteToolCallPreview("Writing command pnpm", call(0));
  controller.noteToolCallPreview("Writing command pnpm test", call(0));

  const current = visible(statuses.at(-1) ?? null);
  assert.equal(current.length, 2);
  assert.match(current[1] ?? "", /pnpm test/);
  assert.doesNotMatch(current[1] ?? "", /pnpm$/);

  controller.stop();
});

test("renders delegated sessions as nested activity rows", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController(
    (status) => statuses.push(status),
    {
      delegatedToolRevealDelayMs: 0,
      delegatedStatusMinVisibleMs: 0,
    },
  );
  controller.start();

  controller.noteToolActivity(
    "Starting session inspect-api",
    {
      ...call(0),
      name: "start_session",
      args: {
        session_id: "inspect-api",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        prompt: "Reading server/src/routes",
      },
    },
  );
  controller.noteToolActivity(
    "Starting session review-types",
    {
      ...call(1),
      name: "start_session",
      args: {
        session_id: "review-types",
        provider: "codex",
        model: "gpt-5.6-mini",
        prompt: "Checking public interfaces",
      },
    },
  );

  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "├─ ◐ Session: inspect-api · google/gemini-3.5-flash-lite",
    "│  └─ Starting delegated task",
    "└─ ◐ Session: review-types · codex/gpt-5.6-mini",
    "   └─ Starting delegated task",
  ]);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: { type: "reasoning", text: "**Inspecting API boundaries**" },
  });
  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "├─ ◐ Session: inspect-api · google/gemini-3.5-flash-lite",
    "│  └─ Thinking: Inspecting API boundaries",
    "└─ ◐ Session: review-types · codex/gpt-5.6-mini",
    "   └─ Starting delegated task",
  ]);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_1",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "review-types",
    event: { type: "reasoning", text: "This belongs to the other call" },
  });
  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "├─ ◐ Session: inspect-api · google/gemini-3.5-flash-lite",
    "│  └─ Thinking: Inspecting API boundaries",
    "└─ ◐ Session: review-types · codex/gpt-5.6-mini",
    "   └─ Starting delegated task",
  ]);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_1",
    parentStep: 1,
    parentIndex: 1,
    sessionId: "review-types",
    event: { type: "reasoning", text: "**Reviewing type boundaries**" },
  });
  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "├─ ◐ Session: inspect-api · google/gemini-3.5-flash-lite",
    "│  └─ Thinking: Inspecting API boundaries",
    "└─ ◐ Session: review-types · codex/gpt-5.6-mini",
    "   └─ Thinking: Reviewing type boundaries",
  ]);

  controller.stop();
});

test("updates a delegated session from real child reasoning and tool events", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController(
    (status) => statuses.push(status),
    {
      workspaceRoot: "/workspace",
      delegatedToolRevealDelayMs: 0,
      delegatedStatusMinVisibleMs: 0,
    },
  );
  controller.start();
  controller.noteToolActivity("Starting session", {
    ...call(0),
    name: "start_session",
    args: { provider: "codex", model: "gpt-5.6" },
  });

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: { type: "reasoning", text: "**Mapping command boundaries**" },
  });
  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_call",
      name: "read_file",
      callId: "child-read",
      args: { path: "/workspace/server/chump_server/agent.py" },
    },
  });

  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "└─ ◐ Session: inspect-api · codex/gpt-5.6",
    "   └─ ◐ Reading file server/chump_server/agent.py",
  ]);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_result",
      name: "read_file",
      callId: "child-read",
      status: "ok",
    },
  });
  assert.deepEqual(visible(statuses.at(-1) ?? null).slice(1), [
    "└─ ◐ Session: inspect-api · codex/gpt-5.6",
    "   └─ Thinking: Mapping command boundaries",
  ]);

  controller.stop();
});

test("only reveals sustained delegated tools and keeps them visible for three seconds", () => {
  const statuses: StatusDisplay[] = [];
  const fake = createFakeActivityClock();
  const controller = createActivityStatusController(
    (status) => statuses.push(status),
    {
      workspaceRoot: "/workspace",
      delegatedToolRevealDelayMs: 3_000,
      delegatedStatusMinVisibleMs: 3_000,
      clock: fake.clock,
    },
  );
  controller.start();
  controller.noteToolActivity("Starting session", {
    ...call(0),
    name: "start_session",
    args: { provider: "codex", model: "gpt-5.6" },
  });
  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: { type: "reasoning", text: "Inspecting API boundaries" },
  });

  fake.advance(3_000);
  assert.match(visible(statuses.at(-1) ?? null).at(-1) ?? "", /Thinking:/);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_call",
      name: "bash",
      callId: "child-bash",
      args: { command: "pnpm test", cwd: "/workspace" },
    },
  });
  fake.advance(2_999);
  assert.match(visible(statuses.at(-1) ?? null).at(-1) ?? "", /Thinking:/);

  fake.advance(1);
  assert.match(visible(statuses.at(-1) ?? null).at(-1) ?? "", /pnpm test/);

  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_result",
      name: "bash",
      callId: "child-bash",
      status: "ok",
    },
  });
  fake.advance(2_999);
  assert.match(visible(statuses.at(-1) ?? null).at(-1) ?? "", /pnpm test/);

  fake.advance(1);
  assert.match(visible(statuses.at(-1) ?? null).at(-1) ?? "", /Thinking:/);

  controller.stop();
});

test("does not flash delegated tools that finish before the reveal delay", () => {
  const statuses: StatusDisplay[] = [];
  const fake = createFakeActivityClock();
  const controller = createActivityStatusController(
    (status) => statuses.push(status),
    {
      delegatedToolRevealDelayMs: 3_000,
      delegatedStatusMinVisibleMs: 3_000,
      clock: fake.clock,
    },
  );
  controller.start();
  controller.noteToolActivity("Starting session", {
    ...call(0),
    name: "start_session",
    args: { provider: "codex", model: "gpt-5.6" },
  });
  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_call",
      name: "write_file",
      callId: "quick-write",
      args: { path: "/workspace/quick.txt", content: "done" },
    },
  });
  fake.advance(500);
  controller.noteDelegatedSessionProgress({
    parentCallId: "call_0",
    parentStep: 1,
    parentIndex: 0,
    sessionId: "inspect-api",
    event: {
      type: "tool_result",
      name: "write_file",
      callId: "quick-write",
      status: "ok",
    },
  });
  fake.advance(5_000);

  assert.doesNotMatch(
    visible(statuses.at(-1) ?? null).join("\n"),
    /quick\.txt|Writing file/,
  );
  controller.stop();
});

test("limits large batches while keeping a hidden failure visible", () => {
  const statuses: StatusDisplay[] = [];
  const controller = createActivityStatusController((status) => statuses.push(status));
  controller.start();

  for (let index = 0; index < 6; index += 1) {
    controller.noteToolActivity(`Tool ${index}`, call(index));
  }
  controller.noteToolResult({ ...call(5), status: "error" });

  const current = visible(statuses.at(-1) ?? null);
  assert.equal(current.length, 6);
  assert.match(current.join("\n"), /× Tool 5/);
  assert.match(current.at(-1) ?? "", /… 2 more/);

  controller.stop();
});

function createFakeActivityClock(): {
  clock: {
    now: () => number;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (timer: object | number) => void;
  };
  advance: (durationMs: number) => void;
} {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { deadline: number; callback: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout: (callback, delayMs) => {
        const timer = nextTimer;
        nextTimer += 1;
        timers.set(timer, { deadline: now + delayMs, callback });
        return timer;
      },
      clearTimeout: (timer) => {
        if (typeof timer === "number") {
          timers.delete(timer);
        }
      },
    },
    advance: (durationMs) => {
      const target = now + durationMs;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= target)
          .sort((left, right) => left[1].deadline - right[1].deadline)[0];
        if (!next) {
          break;
        }
        const [timerId, timer] = next;
        timers.delete(timerId);
        now = timer.deadline;
        timer.callback();
      }
      now = target;
    },
  };
}
