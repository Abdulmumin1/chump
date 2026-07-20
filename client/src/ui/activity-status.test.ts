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
