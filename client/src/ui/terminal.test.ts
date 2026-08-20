import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearTerminal,
  createLiveMarkdownStream,
  setTerminalOutputSink,
  writeCommandActivity,
  writeOutput,
  writeReasoning,
  writeUserMessage,
} from "./terminal.ts";

test("routes output and clears through an active Pi TUI sink", () => {
  const writes: string[] = [];
  let clears = 0;
  setTerminalOutputSink({
    write: (value) => writes.push(value),
    clear: () => {
      clears += 1;
    },
  });

  try {
    writeOutput("hello from Pi");
    clearTerminal();
    assert.deepEqual(writes, ["hello from Pi"]);
    assert.equal(clears, 1);
  } finally {
    setTerminalOutputSink(null);
  }
});

test("routes assistant deltas through the live Pi Markdown stream", () => {
  const chunks: string[] = [];
  let ended = false;
  setTerminalOutputSink({
    write: () => {},
    clear: () => {},
    createMarkdownStream: () => ({
      write: (value) => chunks.push(value),
      end: () => {
        ended = true;
      },
    }),
  });

  try {
    const stream = createLiveMarkdownStream();
    assert.ok(stream);
    stream.write("smooth");
    stream.write(" stream");
    assert.deepEqual(chunks, ["smooth", " stream"]);
    stream.end();
    assert.equal(ended, true);
  } finally {
    setTerminalOutputSink(null);
  }
});

test("routes semantic command and reasoning blocks through the Pi TUI sink", () => {
  const commands: string[] = [];
  const reasoning: string[] = [];
  const userMessages: string[] = [];
  setTerminalOutputSink({
    write: () => {},
    clear: () => {},
    writeCommandActivity: (activity) => commands.push(activity.command),
    writeReasoning: (content) => reasoning.push(content),
    writeUserMessage: (content) => userMessages.push(content),
  });

  try {
    assert.equal(writeCommandActivity({
      command: "printf done",
      status: "ok",
      preview: "done",
      displayOutput: "done",
    }), true);
    assert.equal(writeReasoning("checking the result"), true);
    assert.equal(writeUserMessage("full-width user message"), true);
    assert.deepEqual(commands, ["printf done"]);
    assert.deepEqual(reasoning, ["checking the result"]);
    assert.deepEqual(userMessages, ["full-width user message"]);
  } finally {
    setTerminalOutputSink(null);
  }
});
