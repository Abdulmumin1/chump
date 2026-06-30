import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolActivityRenderer } from "./tool-activity.ts";
import { transcriptEventFromSse } from "./transcript.ts";

test("renders consecutive searches as a compact run without blank lines", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall(searchCall("CHUMP_FFF_COMMAND"));
  renderer.renderToolResult(searchResult("CHUMP_FFF_COMMAND", 4));
  renderer.renderToolCall(searchCall("fff|FFF", "./client"));
  renderer.renderToolResult(searchResult("fff|FFF", 0));

  assert.equal(output.length, 2);
  assert.match(output[0] ?? "", /\n.*CHUMP_FFF_COMMAND.*4 matches/s);
  assert.match(output[1] ?? "", /fff\|FFF.*\.\/client.*no matches/s);
  assert.equal(output[1]?.startsWith("\n"), false);
  assert.equal(output.includes(""), false);
});

test("previews partial bash and write arguments as their JSON streams", () => {
  const renderer = new ToolActivityRenderer(() => {});

  renderer.renderToolCallStream({
    call_id: "call_bash",
    name: "bash",
    step: 1,
    index: 0,
  });
  const bashPreview = renderer.renderToolCallStream({
    call_id: "call_bash",
    step: 1,
    index: 0,
    arguments_delta: '{"command":"printf hel',
  });
  assert.match(bashPreview ?? "", /Writing command/);
  assert.match(bashPreview ?? "", /printf hel/);

  renderer.renderToolCallStream({
    call_id: "call_write",
    name: "write_file",
    step: 1,
    index: 1,
  });
  const writePreview = renderer.renderToolCallStream({
    call_id: "call_write",
    step: 1,
    index: 1,
    arguments_delta:
      '{"path":"demo.ts","content":"export const live = tr',
  });
  assert.match(writePreview ?? "", /Writing file.*demo\.ts/);
  assert.match(writePreview ?? "", /\+1/);
  assert.match(writePreview ?? "", /-0/);

  const longerWritePreview = renderer.renderToolCallStream({
    call_id: "call_write",
    step: 1,
    index: 1,
    arguments_delta: "\\nsecond line",
  });
  assert.match(longerWritePreview ?? "", /\+2/);

  renderer.renderToolCallStream({
    call_id: "call_patch",
    name: "apply_patch",
    step: 1,
    index: 2,
  });
  const patchPreview = renderer.renderToolCallStream({
    call_id: "call_patch",
    step: 1,
    index: 2,
    arguments_delta:
      '{"patch":"*** Update File: demo.ts\\n@@\\n-old\\n+new\\n+extra',
  });
  assert.match(patchPreview ?? "", /Editing file.*demo\.ts/);
  assert.match(patchPreview ?? "", /\+2/);
  assert.match(patchPreview ?? "", /-1/);
});

test("uses present-tense semantic labels for live tool activity", () => {
  const renderer = new ToolActivityRenderer(() => {});

  const runningCommand = renderer.renderToolCall({
    name: "bash",
    args: { command: "pnpm test" },
  });
  assert.match(runningCommand, /Running command.*pnpm test/);

  const reading = renderer.renderToolCallStream({
    call_id: "call_read",
    name: "read_file",
    arguments_delta: '{"path":"src/app.ts"}',
  });
  assert.match(reading ?? "", /Reading file.*src\/app\.ts/);

  const searching = renderer.renderToolCallStream({
    call_id: "call_search",
    name: "search",
    arguments_delta: '{"query":"spinner","path":"client"}',
  });
  assert.match(searching ?? "", /Searching files.*spinner.*client/);
});

test("correlates reverse-completing same-name tools by lifecycle identity", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    ...searchCall("first"),
    call_id: "call_first",
    step: 1,
    index: 0,
  });
  renderer.renderToolCall({
    ...searchCall("second"),
    call_id: "call_second",
    step: 1,
    index: 1,
  });
  renderer.renderToolResult({
    ...searchResult("second", 1),
    call_id: "call_second",
    step: 1,
    index: 1,
  });
  renderer.renderToolResult({
    ...searchResult("first", 1),
    call_id: "call_first",
    step: 1,
    index: 0,
  });

  assert.match(output[0] ?? "", /second/);
  assert.match(output[1] ?? "", /first/);
});

test("keeps each concurrent bash result with its originating command", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "bash",
    args: { command: "printf first" },
    call_id: "call_first",
    step: 1,
    index: 0,
  });
  renderer.renderToolCall({
    name: "bash",
    args: { command: "printf second" },
    call_id: "call_second",
    step: 1,
    index: 1,
  });

  renderer.renderToolResult({
    name: "bash",
    preview: "second output",
    status: "ok",
    call_id: "call_second",
    step: 1,
    index: 1,
  });
  renderer.renderToolResult({
    name: "bash",
    preview: "first output",
    status: "ok",
    call_id: "call_first",
    step: 1,
    index: 0,
  });

  assert.match(output[0] ?? "", /printf second/);
  assert.match(output[1] ?? "", /second output/);
  assert.match(output[3] ?? "", /printf first/);
  assert.match(output[4] ?? "", /first output/);
});

test("renders execution completion immediately and ignores the durable duplicate", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));
  const identity = { call_id: "call_bash", step: 2, index: 0 };

  renderer.renderToolCall({
    name: "bash",
    args: { command: "printf done" },
    ...identity,
  });
  assert.equal(renderer.renderToolResult({
    name: "bash",
    status: "ok",
    preview: "done",
    ...identity,
  }), true);
  assert.equal(renderer.renderToolResult({
    name: "bash",
    status: "ok",
    preview: "done",
    ...identity,
  }), false);

  assert.equal(output.length, 3);
  assert.match(output[1] ?? "", /done/);
});

test("maps live execution-finished events onto tool results", () => {
  const event = transcriptEventFromSse({
    event: "tool_execution.finished",
    data: JSON.stringify({
      call_id: "call_bash",
      name: "bash",
      status: "ok",
      preview: "done",
    }),
  });

  assert.deepEqual(event, {
    type: "tool_result",
    payload: {
      call_id: "call_bash",
      name: "bash",
      status: "ok",
      preview: "done",
    },
  });
});

test("maps provider tool argument deltas onto streaming previews", () => {
  const event = transcriptEventFromSse({
    event: "tool_call.delta",
    data: JSON.stringify({
      call_id: "call_bash",
      step: 1,
      index: 0,
      arguments_delta: '{"command":"printf hel',
    }),
  });

  assert.deepEqual(event, {
    type: "tool_call_stream",
    payload: {
      call_id: "call_bash",
      step: 1,
      index: 0,
      arguments_delta: '{"command":"printf hel',
      lifecycle_type: "tool_call.delta",
    },
  });
});

function searchCall(query: string, path = ""): Record<string, unknown> {
  return {
    name: "search",
    args: { query, path },
  };
}

function searchResult(query: string, totalMatched: number): Record<string, unknown> {
  const matches = Array.from({ length: totalMatched }, () => ({
        path: "client/src/app/runtime.ts",
        line: 1,
        column: 0,
        text: query,
      }));
  return {
    name: "search",
    status: "ok",
    preview: totalMatched > 0 ? query : "No matches found.",
    metadata: { matches, totalMatched, totalFiles: 1 },
  };
}
