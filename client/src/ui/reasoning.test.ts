import assert from "node:assert/strict";
import { test } from "node:test";

import { LiveReasoningTokenCounter } from "./reasoning.ts";

test("estimates live reasoning tokens while deduplicating cumulative chunks", () => {
  const counter = new LiveReasoningTokenCounter();

  assert.equal(counter.update({ text: "Think" }), 2);
  assert.equal(counter.update({ text: "Thinking through it" }), 5);
  assert.equal(counter.update({ text: "Thinking through it" }), 5);
  assert.equal(counter.update({ text: " carefully" }), 8);

  counter.reset();
  assert.equal(counter.update({ text: "" }), 0);
});
