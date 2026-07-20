import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolActivityRenderer } from "./tool-activity.ts";
import {
  TranscriptRenderer,
  transcriptEventFromSse,
  transcriptEventsFromStoredMessages,
} from "./transcript.ts";

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

test("starts a new compact tool run after intervening text", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "read_file",
    args: { path: "first.ts" },
  });
  renderer.renderToolResult({
    name: "read_file",
    status: "ok",
  });

  // The transcript consumes activity before rendering assistant text and uses
  // the return value to insert the blank line above that text.
  assert.equal(renderer.consumeActivity(), true);

  renderer.renderToolCall(searchCall("second"));
  renderer.renderToolResult(searchResult("second", 1));

  assert.equal(output.length, 2);
  assert.match(output[0] ?? "", /\n.*Read.*first\.ts/s);
  assert.match(output[1] ?? "", /\n.*search.*second/s);
});

test("renders each failed read once on its correlated compact row", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));
  const paths = ["first.ts", "second.ts", "third.ts"];

  for (const [index, path] of paths.entries()) {
    renderer.renderToolCall({
      name: "read_file",
      args: { path },
      call_id: `call_${index}`,
      step: 1,
      index,
    });
  }

  assert.equal(output.length, 0);

  for (const [index] of paths.entries()) {
    renderer.renderToolResult({
      name: "read_file",
      status: "error",
      preview: "file not found",
      call_id: `call_${index}`,
      step: 1,
      index,
    });
  }

  assert.equal(output.length, 3);
  assert.match(output[0] ?? "", /\n.*×.*Read.*first\.ts/s);
  assert.match(output[1] ?? "", /×.*Read.*second\.ts/s);
  assert.match(output[2] ?? "", /×.*Read.*third\.ts/s);
  assert.doesNotMatch(output.join("\n"), /file not found/);
  assert.equal(output[1]?.startsWith("\n"), false);
  assert.equal(output[2]?.startsWith("\n"), false);
  assert.equal(output.includes(""), false);
  assert.equal((output.join("\n").match(/Read/g) ?? []).length, 3);
});

test("flushes buffered assistant text before rendering the next tool", () => {
  const order: string[] = [];
  const renderer = new TranscriptRenderer({
    hooks: {
      onBeforeToolActivity: () => order.push("flush-text"),
      onToolActivity: () => order.push("rendered-tool"),
    },
  });

  // Search calls do not write their permanent line until the result, which
  // keeps this ordering test independent from process stdout.
  renderer.render({ type: "tool_call", payload: searchCall("scripts") });

  assert.deepEqual(order, ["flush-text", "rendered-tool"]);
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

  const viewing = renderer.renderToolCallStream({
    call_id: "call_image",
    name: "view_image",
    arguments_delta: '{"path":".chump/tmp/sign.jpeg"}',
  });
  assert.match(viewing ?? "", /Viewing image.*\.chump\/tmp\/sign\.jpeg/);

  const searching = renderer.renderToolCallStream({
    call_id: "call_search",
    name: "search",
    arguments_delta: '{"query":"spinner","path":"client"}',
  });
  assert.match(searching ?? "", /Searching files.*spinner.*client/);
});

test("renders view_image as a semantic completed tool", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "view_image",
    args: { path: ".chump/tmp/sign.jpeg" },
    call_id: "call_image",
  });
  renderer.renderToolResult({
    name: "view_image",
    status: "ok",
    preview: "ToolOutput(text=1, image=1, file=0)",
    call_id: "call_image",
  });

  assert.match(output.at(-2) ?? "", /View image.*\.chump\/tmp\/sign\.jpeg/);
});

test("replays loaded skills without dumping skill content", () => {
  const skillContent = '<skill_content name="svelte-code-writer">\\n# Svelte 5\\n</skill_content>';

  const events = transcriptEventsFromStoredMessages([
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          tool_call: {
            id: "call_skill",
            name: "skill",
            arguments: { name: skillContent },
          },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool_result",
          tool_result: {
            tool_call_id: "call_skill",
            tool_name: "skill",
            result: skillContent,
            is_error: false,
          },
        },
      ],
    },
  ]);

  assert.deepEqual(events, [
    {
      type: "tool_call",
      payload: {
        name: "skill",
        args: { name: "svelte-code-writer" },
        call_id: "call_skill",
        step: undefined,
        index: undefined,
      },
    },
    {
      type: "tool_result",
      payload: {
        name: "skill",
        ok: true,
        status: "ok",
        preview: "Loaded skill: svelte-code-writer",
        call_id: "call_skill",
        step: undefined,
        index: undefined,
      },
    },
  ]);
});

test("does not render argument diff for failed edit results", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "apply_patch",
    args: {
      patch: "*** Update File: demo.txt\n@@\n-old\n+new",
    },
    call_id: "call_patch",
  });
  renderer.renderToolResult({
    name: "apply_patch",
    status: "error",
    preview: "patch failed",
    call_id: "call_patch",
  });

  assert.doesNotMatch(output.join("\n"), /demo\.txt|old|new/);
  assert.match(output.join("\n"), /patch failed/);
});

test("renders deferred argument diff for successful edit replay", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "apply_patch",
    args: {
      patch: "*** Update File: demo.txt\n@@\n-old\n+new",
    },
    call_id: "call_patch",
  });
  renderer.renderToolResult({
    name: "apply_patch",
    status: "ok",
    preview: "Done",
    call_id: "call_patch",
  });

  assert.match(output.join("\n"), /demo\.txt/);
  assert.match(output.join("\n"), /old/);
  assert.match(output.join("\n"), /new/);
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

  assert.match(output[0] ?? "", /first/);
  assert.match(output[1] ?? "", /second/);
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

  assert.equal(output.length, 6);
  assert.match(output[0] ?? "", /printf first/);
  assert.match(output[1] ?? "", /first output/);
  assert.match(output[3] ?? "", /printf second/);
  assert.match(output[4] ?? "", /second output/);
});

test("caps long single-line command output to roughly five terminal rows", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "bash",
    args: { command: "curl http://127.0.0.1:8080/health" },
    call_id: "call_health",
  });
  renderer.renderToolResult({
    name: "bash",
    status: "ok",
    preview: "x".repeat(5000),
    call_id: "call_health",
  });

  const renderedOutput = stripTestAnsi(output[1] ?? "");
  assert.match(renderedOutput, /\.\.\.\[truncated\]$/u);
  assert.ok(renderedOutput.length <= 420);
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

function stripTestAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, "");
}
