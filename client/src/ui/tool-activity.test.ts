import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolActivityRenderer } from "./tool-activity.ts";
import { renderCommand, renderCommandOutput } from "./render.ts";
import {
  TranscriptRenderer,
  transcriptEventFromSse,
  transcriptEventsFromStoredMessages,
} from "./transcript.ts";
import { setTerminalOutputSink } from "./terminal.ts";

test("renders consecutive searches as a compact run without blank lines", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall(searchCall("CHUMP_FFF_COMMAND"));
  renderer.renderToolResult(searchResult("CHUMP_FFF_COMMAND", 4));
  renderer.renderToolCall(searchCall("fff|FFF", "./client"));
  renderer.renderToolResult(searchResult("fff|FFF", 0));

  assert.equal(output.length, 2);
  assert.match(stripTestAnsi(output[0] ?? ""), /\n○ Search/u);
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
  assert.match(output[1] ?? "", /\n.*Search.*second/s);
});

test("title-cases built-in and fallback tool labels", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "custom_tool",
    args: { value: true },
    call_id: "call_custom",
  });
  renderer.renderToolResult({
    name: "custom_tool",
    status: "ok",
    call_id: "call_custom",
  });

  const rendered = stripTestAnsi(output.join("\n"));
  assert.match(rendered, /Custom tool/u);
  assert.doesNotMatch(rendered, /custom_tool/u);
});

test("renders MCP calls with an uppercase label and readable target", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "mcp",
    args: { action: "call_tool", server: "context7", tool_name: "query-docs" },
    call_id: "call_mcp",
  });
  renderer.renderToolResult({ name: "mcp", status: "ok", call_id: "call_mcp" });

  const rendered = stripTestAnsi(output.join("\n"));
  assert.match(rendered, /MCP.*Calling tool.*context7 \/ query-docs/su);
  assert.doesNotMatch(rendered, /\{"action"/u);
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

test("replays stored tool calls even when no live-preview hooks are installed", () => {
  const output: string[] = [];
  setTerminalOutputSink({
    write: (value) => output.push(value),
    clear: () => {},
  });

  try {
    const events = transcriptEventsFromStoredMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call: {
              id: "call_command",
              name: "bash",
              arguments: { command: "pnpm typecheck", cwd: "/workspace" },
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
              tool_call_id: "call_command",
              tool_name: "bash",
              result: "Done in 1.2s",
              is_error: false,
            },
          },
        ],
      },
    ]);
    const renderer = new TranscriptRenderer({ liveReasoning: false });
    for (const event of events) {
      renderer.render(event);
    }
    renderer.finish();

    const rendered = stripTestAnsi(output.join(""));
    assert.match(rendered, /\$ pnpm typecheck/u);
    assert.match(rendered, /Done in 1\.2s/u);
    assert.doesNotMatch(rendered, /\$ command/u);
  } finally {
    setTerminalOutputSink(null);
  }
});

test("replays stored edit calls from their original patch arguments", () => {
  const output: string[] = [];
  setTerminalOutputSink({
    write: (value) => output.push(value),
    clear: () => {},
  });

  try {
    const events = transcriptEventsFromStoredMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            tool_call: {
              id: "call_patch",
              name: "apply_patch",
              arguments: {
                patch_text:
                  "*** Update File: src/demo.ts\n@@\n-old value\n+new value",
              },
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
              tool_call_id: "call_patch",
              tool_name: "apply_patch",
              result: "Applied patch to 1 file",
              is_error: false,
            },
          },
        ],
      },
    ]);
    const renderer = new TranscriptRenderer({ liveReasoning: false });
    for (const event of events) {
      renderer.render(event);
    }
    renderer.finish();

    const rendered = stripTestAnsi(output.join(""));
    assert.match(rendered, /src\/demo\.ts/u);
    assert.match(rendered, /old value/u);
    assert.match(rendered, /new value/u);
    assert.doesNotMatch(rendered, /apply_patch Applied patch/u);
  } finally {
    setTerminalOutputSink(null);
  }
});

test("restores boundaries between persisted reasoning summaries", () => {
  const events = transcriptEventsFromStoredMessages([
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "**Planning output wrapping tests****Designing wrapped command tests**",
        },
        {
          type: "reasoning",
          text: "**Adding terminal width coverage**",
        },
      ],
    },
  ]);

  assert.deepEqual(events, [
    {
      type: "reasoning",
      payload: {
        text:
          "**Planning output wrapping tests**\n\n" +
          "**Designing wrapped command tests**\n\n" +
          "**Adding terminal width coverage**",
        kind: "summary",
        provider: "",
      },
    },
  ]);
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
  assert.match(stripTestAnsi(output[0] ?? ""), /printf first/);
  assert.match(output[1] ?? "", /first output/);
  assert.match(stripTestAnsi(output[3] ?? ""), /printf second/);
  assert.match(output[4] ?? "", /second output/);
});

test("caps long commands to five terminal rows", () => {
  const command = [
    "python3 -c '",
    ...Array.from({ length: 20 }, (_, index) => `print(${index})`),
    "'",
  ].join("\n");
  const rendered = stripTestAnsi(renderCommand(command, 80));
  const lines = rendered.split("\n");

  assert.equal(lines.length, 5);
  assert.match(lines[0] ?? "", /^○ \$ python3 -c '/u);
  assert.match(lines.at(-1) ?? "", /^  │  …$/u);
  assert.doesNotMatch(rendered, /print\(19\)/u);
});

test("caps wrapped single-line commands to five terminal rows", () => {
  const rendered = stripTestAnsi(renderCommand(`printf ${"x".repeat(500)}`, 40));
  const lines = rendered.split("\n");

  assert.equal(lines.length, 5);
  assert.match(lines.at(-1) ?? "", /^  │  …$/u);
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

test("cleans, formats, and indents multiline command output with tree markers", () => {
  const output: string[] = [];
  const renderer = new ToolActivityRenderer((value = "") => output.push(value));

  renderer.renderToolCall({
    name: "bash",
    args: {
      command:
        `python3 -c "print('<span class='line'>def delete_quote(id_):</span>')"`,
    },
    call_id: "call_sync",
  });
  renderer.renderToolResult({
    name: "bash",
    status: "ok",
    preview: `...[command output truncated: showing last 5 of 3445 lines; showing last 1000 of 700530 bytes]

324: <span class="line"></span>
325: <span class="line"><span style="color: var(--shiki-token-keyword)">def</span> delete_quote(id_):</span>
326: <span class="line">    print(f"Deleting quote: {id_}")</span>`,
    call_id: "call_sync",
  });

  const commandLine = stripTestAnsi(output[0] ?? "");
  const outputLine = stripTestAnsi(output[1] ?? "");

  assert.match(commandLine, /^○\s+\$\s+python3 -c/mu);
  if (!process.env.NO_COLOR) {
    assert.match(output[0] ?? "", /\x1b\[38;2;/u);
  }
  assert.doesNotMatch(commandLine, /<\/?span/iu);
  assert.match(outputLine, /^\s+└─\s+324/mu);
  assert.match(outputLine, /^\s+325\s+def delete_quote\(id_\):/mu);
  assert.match(outputLine, /^\s+326\s+print\(f"Deleting quote: \{id_\}"\)/mu);
  assert.match(outputLine, /^\s+\.\.\.\s+\+3,440\s+lines truncated/mu);
});

test("keeps wrapped command errors indented beneath their tree branch", () => {
  const rendered = stripTestAnsi(renderCommandOutput(
    "error",
    "python3: can't open file '/a/very/long/path/to/scripts/sync_data.py': No such file or directory",
    44,
  ));
  const lines = rendered.split("\n");

  assert.match(lines[0] ?? "", /^  └─ python3:/u);
  assert.ok(lines.length > 1);
  for (const line of lines.slice(1)) {
    assert.match(line, /^ {5}\S/u);
  }
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

test("replays manual skill prompts as compact slash commands", () => {
  const events = transcriptEventsFromStoredMessages([
    {
      role: "user",
      content:
        '<skill_content name="release">\n# Release\n</skill_content>' +
        "\n\nUser: publish patch",
    },
  ]);

  assert.deepEqual(events, [
    {
      type: "user_message",
      payload: {
        schema_version: 1,
        content: "/skill:release publish patch",
      },
    },
  ]);
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
