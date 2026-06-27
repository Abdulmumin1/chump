import assert from "node:assert/strict";
import { test } from "node:test";

import {
  noteInputActivity,
  setActiveDraft,
  writeOutput,
} from "./terminal.ts";

test("gives keyboard activity priority over streaming writes", async () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const writes: Array<{ at: number; value: string }> = [];
  process.stdout.write = ((value: string | Uint8Array) => {
    const rendered = String(value);
    if (rendered.includes("__CHUMP_STREAM_PAYLOAD__")) {
      writes.push({ at: Date.now(), value: rendered });
      return true;
    }
    return originalWrite(value);
  }) as typeof process.stdout.write;

  try {
    setActiveDraft({
      buildClear: () => "<clear>",
      buildRedraw: () => "<draft>",
    });
    const inputAt = Date.now();
    writeOutput("__CHUMP_STREAM_PAYLOAD__");
    noteInputActivity();

    assert.equal(writes.length, 0);
    await delay(180);
    assert.equal(writes.length, 1);
    assert.ok((writes[0]?.at ?? 0) - inputAt >= 100);
    assert.match(writes[0]?.value ?? "", /<clear>__CHUMP_STREAM_PAYLOAD__\n<draft>/);
  } finally {
    setActiveDraft(null);
    process.stdout.write = originalWrite as typeof process.stdout.write;
  }
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
