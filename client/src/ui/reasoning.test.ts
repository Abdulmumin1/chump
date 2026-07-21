import assert from "node:assert/strict";
import { test } from "node:test";

import { LiveReasoningStream, LiveReasoningTokenCounter } from "./reasoning.ts";
import { createTuiMarkdownTheme } from "./render.ts";
import { setTerminalOutputSink } from "./terminal.ts";
import { TuiTranscript } from "./tui/components.ts";

test("estimates live reasoning tokens while deduplicating cumulative chunks", () => {
  const counter = new LiveReasoningTokenCounter();

  assert.equal(counter.update({ text: "Think" }), 2);
  assert.equal(counter.update({ text: "Thinking through it" }), 5);
  assert.equal(counter.update({ text: "Thinking through it" }), 5);
  assert.equal(counter.update({ text: " carefully" }), 8);

  counter.reset();
  assert.equal(counter.update({ text: "" }), 0);
});

test("routes completed reasoning Markdown through Pi's Markdown stream", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  setTerminalOutputSink({
    write: (value) => transcript.append(value),
    clear: () => transcript.clear(),
    createMarkdownStream: () =>
      transcript.createMarkdownStream((value) => value, () => {}),
  });

  try {
    const reasoning = new LiveReasoningStream();
    reasoning.render({
      text: "| Plan | Done |\n| --- | --- |\n| Parse Markdown | Yes |",
    });
    reasoning.finish();

    const rendered = transcript.render(80).join("\n");
    assert.match(rendered, /Thinking:/);
    assert.match(rendered, /┌.*┬.*┐/);
    assert.match(rendered, /Parse Markdown/);
    assert.doesNotMatch(rendered, /\| --- \|/);
  } finally {
    setTerminalOutputSink(null);
  }
});
