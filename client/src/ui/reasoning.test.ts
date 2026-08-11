import assert from "node:assert/strict";
import { test } from "node:test";

import { LiveReasoningStream, LiveReasoningTokenCounter } from "./reasoning.ts";
import { createTuiMarkdownTheme } from "./render.ts";
import { setTerminalOutputSink } from "./terminal.ts";
import { TuiTranscript } from "./tui/components.ts";

const ANSI = /\x1b\[[0-9;]*m/gu;

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

test("keeps adjacent live reasoning summaries on separate lines", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  setTerminalOutputSink({
    write: (value) => transcript.append(value),
    clear: () => transcript.clear(),
    createMarkdownStream: () =>
      transcript.createMarkdownStream((value) => value, () => {}),
  });

  try {
    const reasoning = new LiveReasoningStream();
    reasoning.render({ text: "**Planning nested tool rendering**" });
    reasoning.render({ text: "**Designing session tool status rendering**" });
    reasoning.finish();

    const lines = transcript.render(120)
      .map((line) => line.replace(ANSI, "").trimEnd());
    const planningLine = lines.findIndex((line) =>
      line.includes("Planning nested tool rendering")
    );
    const designingLine = lines.findIndex((line) =>
      line.includes("Designing session tool status rendering")
    );
    assert.ok(planningLine >= 0);
    assert.ok(designingLine >= planningLine + 2);
  } finally {
    setTerminalOutputSink(null);
  }
});
