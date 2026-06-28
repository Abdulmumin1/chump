import assert from "node:assert/strict";
import { test } from "node:test";

import { StdinBuffer } from "./stdin-buffer.ts";

test("coalesces a printable input burst without losing characters", () => {
  const buffer = new StdinBuffer();
  const events: string[] = [];
  buffer.on("data", (value) => events.push(value));

  const burst = "the quick brown fox jumps over the lazy dog".repeat(50);
  buffer.process(burst);

  assert.deepEqual(events, [burst]);
  buffer.destroy();
});

test("preserves control-key ordering inside a coalesced chunk", () => {
  const buffer = new StdinBuffer();
  const events: string[] = [];
  buffer.on("data", (value) => events.push(value));

  buffer.process("first\rsecond\u007f!");

  assert.deepEqual(events, ["first", "\r", "second", "\u007f", "!"]);
  buffer.destroy();
});

test("waits for split escape sequences", () => {
  const buffer = new StdinBuffer({ timeout: 100 });
  const events: string[] = [];
  buffer.on("data", (value) => events.push(value));

  buffer.process("\x1b[");
  assert.deepEqual(events, []);

  buffer.process("Dafter");
  assert.deepEqual(events, ["\x1b[D", "after"]);
  buffer.destroy();
});

test("preserves UTF-8 characters split across raw chunks", () => {
  const buffer = new StdinBuffer();
  const events: string[] = [];
  buffer.on("data", (value) => events.push(value));
  const encoded = Buffer.from("é🙂", "utf8");

  buffer.process(encoded.subarray(0, 1));
  buffer.process(encoded.subarray(1, 4));
  buffer.process(encoded.subarray(4));

  assert.equal(events.join(""), "é🙂");
  assert.equal(events.join("").includes("�"), false);
  buffer.destroy();
});

test("keeps bracketed paste separate from following typing", () => {
  const buffer = new StdinBuffer();
  const dataEvents: string[] = [];
  const pasteEvents: string[] = [];
  buffer.on("data", (value) => dataEvents.push(value));
  buffer.on("paste", (value) => pasteEvents.push(value));

  buffer.process("\x1b[200~pasted text\x1b[201~typed next");

  assert.deepEqual(pasteEvents, ["pasted text"]);
  assert.deepEqual(dataEvents, ["typed next"]);
  buffer.destroy();
});
