import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AutocompleteProvider,
  type EditorTheme,
  type Terminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";

import type { SessionSummary } from "../core/types.ts";
import { ChumpAutocompleteProvider } from "./tui/autocomplete.ts";
import {
  MutableLines,
  CompactToolGroup,
  SessionFooter,
  StreamingText,
  TranscriptGap,
  TuiTranscript,
} from "./tui/components.ts";
import {
  createTuiMarkdownTheme,
  renderFileChangeSummary,
  renderTuiMuted,
  renderUserMessage,
} from "./render.ts";
import {
  registerTuiExtension,
  resolveTuiExtensions,
} from "./tui/extensions.ts";
import { ChumpEditor } from "./tui/editor.ts";
import { handleTranscriptToggleKey } from "./tui/shell.ts";

test("Pi TUI streaming text wraps output without losing blank lines", () => {
  const output = new StreamingText();
  output.append("first line\n\n\nsecond line\n");

  assert.deepEqual(output.render(80), ["first line", "", "second line"]);
  assert.equal(output.render(5).every((line) => line.length <= 5), true);

  output.clear();
  assert.deepEqual(output.render(80), []);
});

test("Pi TUI mutable lines stay within the viewport", () => {
  const lines = new MutableLines();
  lines.set(["a very long status"]);
  assert.equal(visibleWidth(lines.render(8)[0] ?? ""), 8);
  lines.set([]);
  assert.deepEqual(lines.render(8), []);
});

test("Pi TUI mutable lines flatten streamed command newlines", () => {
  const lines = new MutableLines();
  lines.set(["Writing command python3 -c '\nimport os\r\nprint(1)'"]);

  const rendered = lines.render(80);
  assert.equal(rendered.length, 1);
  assert.doesNotMatch(rendered[0] ?? "", /[\r\n]/u);
  assert.equal(
    rendered[0],
    "Writing command python3 -c ' ↵ import os ↵ print(1)'",
  );
});

test("Pi TUI status lines count characters hidden by a narrow viewport", () => {
  const lines = new MutableLines({ showHiddenCharacterCount: true });
  const command = "Writing command printf 'abcdefghijklmnopqrstuvwxyz'";
  lines.set([command]);

  const short = stripTestAnsi(lines.render(30)[0] ?? "");
  assert.equal(visibleWidth(short), 30);
  assert.match(short, /… \(\+34 chars\)$/u);

  lines.set([`${command} --with-more-arguments`]);
  const longer = stripTestAnsi(lines.render(30)[0] ?? "");
  assert.match(longer, /… \(\+(\d+) chars\)$/u);
  const shortCount = Number(/\+(\d+) chars/.exec(short)?.[1]);
  const longerCount = Number(/\+(\d+) chars/.exec(longer)?.[1]);
  assert.ok(longerCount > shortCount);
});

test("Pi TUI status lines preserve file change counts when paths overflow", () => {
  const lines = new MutableLines({ showHiddenCharacterCount: true });
  lines.set([
    renderFileChangeSummary(
      "Writing file",
      "client/src/ui/a-very-long-directory/a-very-long-file-name.ts",
      142,
      7,
    ),
  ]);

  const rendered = stripTestAnsi(lines.render(36)[0] ?? "");
  assert.equal(visibleWidth(rendered), 36);
  assert.match(rendered, /… \+142 -7$/u);
  assert.doesNotMatch(rendered, /chars/u);
});

test("Chump footer gives location, context, and session metadata their own rows", () => {
  const footer = new SessionFooter((value) => value);
  footer.setFooter("~/Documents/projects/chump (main)\ncodex/gpt-5.6-sol · thinking medium");
  footer.setContext("ctx 7.9K / 1.1M");

  const lines = footer.render(80);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "~/Documents/projects/chump (main)");
  assert.equal(lines[1], "ctx 7.9K / 1.1M");
  assert.equal(lines[2], "codex/gpt-5.6-sol · thinking medium");
});

test("Pi TUI live Markdown updates before a newline arrives", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  let changes = 0;
  const stream = transcript.createMarkdownStream((value) => value, () => {
    changes += 1;
  });

  stream.write("partial");
  assert.equal(changes, 1);
  assert.match(transcript.render(80).join("\n"), /partial/);
  stream.write(" response");
  assert.equal(changes, 2);
  assert.match(transcript.render(80).join("\n"), /partial response/);
});

test("Pi TUI renders Markdown LaTeX as terminal-friendly Unicode", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  const stream = transcript.createMarkdownStream((value) => value, () => {});

  stream.write("Inline math: $x^2 + y^2$");
  stream.end();

  assert.match(
    stripTestAnsi(transcript.render(80).join("\n")),
    /Inline math: x² \+ y²/u,
  );
});

test("Pi TUI transcript uses one semantic gap between user and assistant", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.append("\n※ hello\n");
  const stream = transcript.createMarkdownStream((value) => value, () => {});
  stream.write("Hi there");

  const lines = transcript.render(80).map((line) => line.trimEnd());
  assert.equal(lines[0], "");
  assert.equal(lines[1], "※ hello");
  assert.equal(lines[2], "");
  assert.match(lines[3] ?? "", /Hi there/);
});

test("Pi TUI input gap does not stack with a transcript blank", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  const gap = new TranscriptGap(transcript);

  transcript.append("context\n\n");
  assert.deepEqual(transcript.render(80), ["context", ""]);
  assert.deepEqual(gap.render(80), []);

  transcript.append("※ question\n");
  assert.deepEqual(gap.render(80), [""]);
});

test("Pi TUI compact tool runs keep one semantic gap and upgrade contiguous repeats", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendReasoning("I will inspect the files.");
  transcript.appendCompactToolRun({
    toolName: "read_file",
    label: "Read",
    status: "ok",
    args: "client/src/ui/tui.test.ts offset=360 limit=50",
    preview: "client/src/ui/tui.test.ts offset=360 limit=50",
    fallbackLine: "○ Read client/src/ui/tui.test.ts offset=360 limit=50",
  });
  transcript.appendCompactToolRun({
    toolName: "read_file",
    label: "Read",
    status: "ok",
    args: "client/src/ui/tui.test.ts offset=410 limit=100",
    preview: "client/src/ui/tui.test.ts offset=410 limit=100",
    fallbackLine: "○ Read client/src/ui/tui.test.ts offset=410 limit=100",
  });

  const lines = transcript.render(100).map((line) => stripTestAnsi(line).trimEnd());
  const thinkingIndex = lines.findIndex((line) => /I will inspect/u.test(line));
  const headerIndex = lines.findIndex((line) => /^○ Read/u.test(line));

  assert.equal(lines[thinkingIndex + 1], "");
  assert.equal(headerIndex, thinkingIndex + 2);
  assert.match(lines[headerIndex + 1] ?? "", /├─ client\/src\/ui\/tui\.test\.ts offset=360 limit=50/u);
  assert.match(lines[headerIndex + 2] ?? "", /└─ client\/src\/ui\/tui\.test\.ts offset=410 limit=100/u);
});

test("Pi TUI mixed compact tool runs do not add blank rows between tools", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.append("assistant context\n");
  transcript.appendCompactToolRun({
    toolName: "search",
    label: "Search",
    status: "ok",
    args: '"foo" in client',
    preview: '"foo" in client (1 match)',
    fallbackLine: '○ Search "foo" in client (1 match)',
  });
  transcript.appendCompactToolRun({
    toolName: "read_file",
    label: "Read",
    status: "ok",
    args: "client/src/ui/tui.test.ts offset=1 limit=10",
    preview: "client/src/ui/tui.test.ts offset=1 limit=10",
    fallbackLine: "○ Read client/src/ui/tui.test.ts offset=1 limit=10",
  });

  const lines = transcript.render(100).map((line) => stripTestAnsi(line).trimEnd());
  assert.deepEqual(lines, [
    "assistant context",
    "",
    '○ Search "foo" in client (1 match)',
    "○ Read client/src/ui/tui.test.ts offset=1 limit=10",
  ]);
});

test("Pi TUI command activities expand globally and new commands inherit the state", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendCommandActivity({
    command: "printf output",
    status: "ok",
    preview: "line 1\n...[truncated]",
    displayOutput: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
  });

  const collapsed = stripTestAnsi(transcript.render(80).join("\n"));
  assert.match(collapsed, /line 1/u);
  assert.match(collapsed, /line 2/u);
  assert.match(collapsed, /… \+8 lines \(ctrl\+o to expand\)/u);
  assert.match(collapsed, /line 11/u);
  assert.match(collapsed, /line 12/u);
  assert.doesNotMatch(collapsed, /line 6/u);
  assert.match(collapsed, /ctrl\+o to expand/u);

  transcript.setToolsExpanded(true);
  const expanded = stripTestAnsi(transcript.render(80).join("\n"));
  assert.match(expanded, /line 12/u);
  assert.doesNotMatch(expanded, /ctrl\+o to expand/u);

  transcript.appendCommandActivity({
    command: "printf inherited",
    status: "ok",
    preview: "done",
    displayOutput: "done",
  });
  assert.match(stripTestAnsi(transcript.render(80).join("\n")), /printf inherited/u);
  assert.equal(transcript.areToolsExpanded(), true);
});

test("Pi TUI expansion restores wrapped single-line commands and output", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  const commandTail = "command-tail";
  const outputTail = "output-tail";
  transcript.appendCommandActivity({
    command: `${"echo very-long ".repeat(20)}${commandTail}`,
    status: "ok",
    preview: `${"result ".repeat(80)}${outputTail}`,
    displayOutput: `${"result ".repeat(80)}${outputTail}`,
  });

  const collapsed = stripTestAnsi(transcript.render(24).join("\n"));
  assert.doesNotMatch(collapsed, new RegExp(commandTail, "u"));
  assert.match(collapsed, new RegExp(outputTail, "u"));

  transcript.setToolsExpanded(true);
  const expanded = stripTestAnsi(transcript.render(24).join("\n"));
  assert.match(expanded, new RegExp(commandTail, "u"));
  assert.match(expanded, new RegExp(outputTail, "u"));
});

test("Pi TUI expansion preserves byte-only server truncation warnings", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendCommandActivity({
    command: "printf large-line",
    status: "ok",
    preview: "tail ...[truncated]",
    displayOutput:
      "...[command output truncated: showing last 1 of 1 lines; showing last 51200 of 60000 bytes]\n\ntail",
  });

  transcript.setToolsExpanded(true);
  const expanded = stripTestAnsi(transcript.render(80).join("\n"));
  assert.match(expanded, /8,800 bytes unavailable \(server limit\)/u);
});

test("Pi TUI thinking blocks toggle globally and inherit hidden state", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendReasoning("first private thought");
  assert.match(stripTestAnsi(transcript.render(80).join("\n")), /\n  first private thought/u);

  transcript.setThinkingVisible(false);
  assert.doesNotMatch(stripTestAnsi(transcript.render(80).join("\n")), /first private thought/u);

  transcript.appendReasoning("second private thought");
  assert.doesNotMatch(stripTestAnsi(transcript.render(80).join("\n")), /second private thought/u);

  transcript.setThinkingVisible(true);
  const visible = stripTestAnsi(transcript.render(80).join("\n"));
  assert.match(visible, /\n  first private thought/u);
  assert.match(visible, /\n  second private thought/u);
  assert.doesNotMatch(visible, /│ first private thought/u);

  const narrow = stripTestAnsi(transcript.render(12).join("\n"));
  assert.equal(
    narrow
      .split("\n")
      .filter((line) => line.length > 0)
      .every((line) => line === "Thinking:" || line.startsWith("  ")),
    true,
  );
  assert.equal(
    transcript.render(161).every((line) => visibleWidth(line) <= 161),
    true,
  );
});

test("Pi TUI thinking Markdown remains fully muted", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendReasoning(
    "Everything is published:\n\n- npm **chump-agent@0.3.5** and `chump-server`",
  );

  const rendered = transcript.render(100);
  const labelIndex = rendered.findIndex((line) =>
    stripTestAnsi(line).trim() === "Thinking:"
  );
  const body = rendered.slice(labelIndex + 1).filter((line) =>
    stripTestAnsi(line).trim().length > 0
  );
  const mutedColor = /\x1b\[38;2;\d+;\d+;\d+m/u.exec(renderTuiMuted("muted"))?.[0];
  assert.ok(mutedColor);
  assert.ok(body.length > 0);
  for (const line of body) {
    const colors = line.match(/\x1b\[38;2;\d+;\d+;\d+m/gu) ?? [];
    assert.ok(colors.length > 0, `expected muted color in ${JSON.stringify(line)}`);
    assert.deepEqual([...new Set(colors)], [mutedColor]);
  }
});

test("Pi TUI transcript shortcuts are consumed without affecting other input", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  let renders = 0;
  const handle = (data: string) =>
    handleTranscriptToggleKey(data, transcript, () => {
      renders += 1;
    });

  assert.equal(handle("\x0f"), true);
  assert.equal(transcript.areToolsExpanded(), true);
  assert.equal(handle("\x14"), true);
  assert.equal(transcript.isThinkingVisible(), false);
  assert.equal(handle("typed text"), false);
  assert.equal(renders, 2);
});

test("Pi TUI muted colors do not use terminal-dependent SGR dim", () => {
  assert.doesNotMatch(renderTuiMuted("legible"), /\x1b\[2m/);
});

test("user messages render as compact Chump-colored surfaces", () => {
  const rendered = renderUserMessage("hye", 24).split("\n");

  assert.equal(rendered.length, 2);
  assert.equal(rendered[0], "");
  assert.equal(visibleWidth(rendered[1] ?? ""), 24);
  assert.match(rendered[1] ?? "", /^\x1b\[48;2;/u);
  assert.match(stripTestAnsi(rendered[1] ?? ""), /^› hye\s+$/u);
});

test("wrapped user messages keep the compact surface and alignment", () => {
  const rendered = renderUserMessage(
    "a user message that wraps cleanly",
    18,
  ).split("\n").slice(1);

  assert.ok(rendered.length > 1);
  assert.equal(rendered.every((line) => visibleWidth(line) === 18), true);
  assert.match(stripTestAnsi(rendered[0] ?? ""), /^› /u);
  for (const line of rendered.slice(1)) {
    assert.match(stripTestAnsi(line), /^ {2}\S/u);
  }
});

test("Pi TUI user-message surfaces follow the current viewport width", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  transcript.appendUserMessage("responsive");

  const wide = transcript.render(40).filter((line) => line.length > 0);
  const narrow = transcript.render(20).filter((line) => line.length > 0);
  assert.equal(visibleWidth(wide[0] ?? ""), 40);
  assert.equal(visibleWidth(narrow[0] ?? ""), 20);
  assert.match(stripTestAnsi(wide[0] ?? ""), /^› responsive\s+$/u);
  assert.match(stripTestAnsi(narrow[0] ?? ""), /^› responsive\s+$/u);
});

test("Pi TUI reuses an unchanged transcript render while typing", () => {
  const transcript = new TuiTranscript(createTuiMarkdownTheme());
  for (let index = 0; index < 200; index += 1) {
    transcript.appendUserMessage(`message ${index}`);
    transcript.append(`response ${index}\n`);
  }

  const initial = transcript.render(80);
  assert.equal(transcript.render(80), initial);

  const resized = transcript.render(60);
  assert.notEqual(resized, initial);
  assert.equal(transcript.render(60), resized);

  transcript.append("new response");
  const updated = transcript.render(60);
  assert.notEqual(updated, resized);
  assert.equal(transcript.render(60), updated);
});

test("built-in Pi autocomplete serves slash commands and file mentions", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({ sessions: [], models: [], skills: [], mcps: [] });
  provider.setFileSearch(async (query) => [{
    path: `src/${query || "index"}.ts`,
    name: `${query || "index"}.ts`,
    score: 1,
  }]);

  const slash = await provider.getSuggestions(
    ["/he"],
    0,
    3,
    { signal: new AbortController().signal },
  );
  assert.equal(slash?.items[0]?.value, "/help");

  const files = await provider.getSuggestions(
    ["read @app"],
    0,
    9,
    { signal: new AbortController().signal },
  );
  assert.equal(files?.prefix, "@app");
  assert.equal(files?.items[0]?.value, "@src/app.ts");

  const applied = provider.applyCompletion(
    ["read @app"],
    0,
    9,
    files!.items[0]!,
    files!.prefix,
  );
  assert.deepEqual(applied.lines, ["read @src/app.ts "]);
});

test("fill-only slash completions remain in the editor", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({ sessions: [], models: [], skills: [], mcps: [] });
  const suggestions = await provider.getSuggestions(
    ["/mo"],
    0,
    3,
    { signal: new AbortController().signal },
  );
  const item = suggestions!.items[0]!;
  provider.applyCompletion(["/mo"], 0, 3, item, suggestions!.prefix);

  assert.equal(provider.consumeFillCompletion("/model"), true);
  assert.equal(provider.consumeFillCompletion("/model"), false);
});

test("exact picker commands expand before their option suggestions", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({
    sessions: [],
    models: [{
      provider: "codex",
      model: "gpt-5.6-sol",
      label: "codex/gpt-5.6-sol",
      description: "Codex",
    }],
    skills: [],
    mcps: [],
  });

  const root = await provider.getSuggestions(
    ["/model"],
    0,
    6,
    { signal: new AbortController().signal },
  );
  assert.equal(root?.items[0]?.value, "/model ");
  assert.equal(provider.shouldOpenPicker("/model"), true);

  const models = await provider.getSuggestions(
    ["/model "],
    0,
    7,
    { signal: new AbortController().signal, force: true },
  );
  assert.equal(models?.items[0]?.value, "/model codex/gpt-5.6-sol");
  assert.equal(
    provider.shouldTriggerFileCompletion(["/model "], 0, 7),
    true,
  );

  const shareRoot = await provider.getSuggestions(
    ["/share"],
    0,
    6,
    { signal: new AbortController().signal },
  );
  assert.equal(shareRoot?.items[0]?.value, "/share ");
  assert.equal(provider.shouldOpenPicker("/share"), true);

  const shareOptions = await provider.getSuggestions(
    ["/share "],
    0,
    7,
    { signal: new AbortController().signal, force: true },
  );
  assert.deepEqual(
    shareOptions?.items.map((item) => item.value),
    ["/share start", "/share status", "/share stop"],
  );
  assert.equal(
    provider.shouldTriggerFileCompletion(["/share "], 0, 7),
    true,
  );
});

test("sub-agent picker reflects sessions discovered after initialization", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({ sessions: [], models: [], skills: [], mcps: [] });

  provider.setSubagentSuggestions(["inspect-api", "review-types"]);

  const suggestions = await provider.getSuggestions(
    ["/sub "],
    0,
    5,
    { signal: new AbortController().signal, force: true },
  );
  assert.deepEqual(
    suggestions?.items.map((item) => item.value),
    ["/sub ..", "/sub inspect-api", "/sub review-types"],
  );
});

test("share picker submits start instead of reopening itself", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({ sessions: [], models: [], skills: [], mcps: [] });
  const editor = createTestEditor(provider);
  const submissions: string[] = [];
  editor.onSubmit = (value) => {
    if (provider.shouldOpenPicker(value)) {
      editor.openPicker(value);
      return;
    }
    submissions.push(value);
  };

  editor.setText("/share");
  editor.handleInput("\r");
  await flushAutocomplete();
  assert.equal(editor.isShowingAutocomplete(), true);

  editor.handleInput("\r");
  await flushAutocomplete();
  assert.deepEqual(submissions, ["/share start"]);
  assert.equal(editor.isShowingAutocomplete(), false);
});

test("submitted picker autocomplete closes when its trigger no longer matches", async () => {
  const provider = new ChumpAutocompleteProvider();
  provider.setContext({
    sessions: [
      sessionSummary("recent", "Recent conversation", 20),
      sessionSummary("older", "Older conversation", 10),
    ],
    models: [{
      provider: "codex",
      model: "gpt-5.6-sol",
      label: "codex/gpt-5.6-sol",
      description: "Codex",
    }, {
      provider: "openai",
      model: "gpt-5.6",
      label: "openai/gpt-5.6",
      description: "OpenAI",
    }],
    skills: [],
    mcps: [{
      name: "github",
      type: "stdio",
      status: "connected",
      tools: 2,
    }, {
      name: "linear",
      type: "http",
      status: "connected",
      tools: 3,
    }],
  });

  for (const command of [
    "/model",
    "/session",
    "/share",
    "/thinking",
    "/mcps",
    "/mcp",
  ]) {
    const editor = createTestEditor(provider);
    editor.onSubmit = (value) => editor.openPicker(value);

    editor.setText(command);
    editor.handleInput("\r");
    await flushAutocomplete();
    assert.equal(
      editor.isShowingAutocomplete(),
      true,
      `${command} picker should open`,
    );

    editor.handleInput("\x7f");
    assert.equal(editor.getText(), command);
    assert.equal(
      editor.isShowingAutocomplete(),
      false,
      `${command} picker should close after removing its trigger space`,
    );
  }
});

test("forced file autocomplete closes when its mention is removed", async () => {
  const provider: AutocompleteProvider = {
    triggerCharacters: ["@"],
    getSuggestions: async (lines, cursorLine, cursorCol) => {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      return beforeCursor.startsWith("@")
        ? {
          prefix: beforeCursor,
          items: [
            { value: "@file.ts", label: "file.ts" },
            { value: "@folder.ts", label: "folder.ts" },
          ],
        }
        : null;
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
      const line = lines[cursorLine] ?? "";
      const start = cursorCol - prefix.length;
      return {
        lines: [line.slice(0, start) + item.value + line.slice(cursorCol)],
        cursorLine,
        cursorCol: start + item.value.length,
      };
    },
    shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) => {
      return (lines[cursorLine] ?? "").slice(0, cursorCol).startsWith("@");
    },
  };
  const editor = createTestEditor(provider);
  editor.setText("@a");

  editor.handleInput("\t");
  await flushAutocomplete();
  assert.equal(editor.isShowingAutocomplete(), true);

  editor.handleInput("\x7f");
  editor.handleInput("\x7f");
  assert.equal(editor.getText(), "");
  assert.equal(editor.isShowingAutocomplete(), false);
});

test("session picker lazily loads and searches every session page", async () => {
  const provider = new ChumpAutocompleteProvider();
  const recent = sessionSummary("recent", "Recent conversation", 20);
  const older = sessionSummary("older", "Archived deployment notes", 10);
  let loads = 0;
  provider.setContext({ sessions: [recent], models: [], skills: [], mcps: [] });
  provider.setSessionSuggestionLoader(async () => {
    loads += 1;
    return [recent, older];
  });

  const all = await provider.getSuggestions(
    ["/session "],
    0,
    9,
    { signal: new AbortController().signal, force: true },
  );
  assert.deepEqual(
    all?.items.map((item) => item.value),
    ["/session recent", "/session older"],
  );

  provider.setCommandContext({ models: [], skills: [] });
  const filtered = await provider.getSuggestions(
    ["/session archived"],
    0,
    17,
    { signal: new AbortController().signal },
  );
  assert.deepEqual(
    filtered?.items.map((item) => item.value),
    ["/session older"],
  );
  assert.equal(loads, 1);
});

test("in-process Pi TUI extensions can be registered and removed", async () => {
  const extension = () => {};
  const unregister = registerTuiExtension("test-extension", extension);
  try {
    const resolved = await resolveTuiExtensions();
    assert.equal(
      resolved.some((item) => item.id === "test-extension" && item.extension === extension),
      true,
    );
  } finally {
    unregister();
  }

  assert.equal(
    (await resolveTuiExtensions()).some((item) => item.id === "test-extension"),
    false,
  );
});

test("CompactToolGroup renders grouped tool runs with tree markers", () => {
  const group = new CompactToolGroup({
    toolName: "search",
    label: "Search",
    status: "ok",
    args: '"foo" in client',
    preview: '"foo" in client (4 matches)',
    fallbackLine: '○ Search "foo" in client (4 matches)',
  });

  group.addRun({
    status: "ok",
    args: '"bar" in client',
    preview: '"bar" in client (no matches)',
    fallbackLine: '○ Search "bar" in client (no matches)',
  });

  const rendered = group.render(80).map((line) => stripTestAnsi(line));
  assert.equal(rendered.length, 3);
  assert.match(rendered[0] ?? "", /Search/u);
  assert.match(rendered[1] ?? "", /├─ "foo" in client \(4 matches\)/u);
  assert.match(rendered[2] ?? "", /└─ "bar" in client \(no matches\)/u);
});

test("CompactToolGroup marks a grouped failure in its header", () => {
  const group = new CompactToolGroup({
    toolName: "read_file",
    label: "Read",
    status: "error",
    args: "missing-a",
    preview: "missing-a",
    fallbackLine: "× Read missing-a",
  });
  group.addRun({
    status: "error",
    args: "missing-b",
    preview: "missing-b",
    fallbackLine: "× Read missing-b",
  });

  const rendered = group.render(80).map((line) => stripTestAnsi(line));
  assert.match(rendered[0] ?? "", /^× Read/u);
  assert.match(rendered[1] ?? "", /├─ × missing-a/u);
  assert.match(rendered[2] ?? "", /└─ × missing-b/u);
});

test("CompactToolGroup renders a completed session with its result preview", () => {
  const group = new CompactToolGroup({
    toolName: "start_session",
    label: "Session",
    status: "ok",
    args: "child-session",
    preview: "Child final answer.",
    fallbackLine: "○ Session child-session · Child final answer.",
  });

  assert.deepEqual(group.render(80).map((line) => stripTestAnsi(line)), [
    "○ Session child-session",
    "  └─ Child final answer.",
  ]);
});

function stripTestAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/gu, "");
}

const testEditorTheme: EditorTheme = {
  borderColor: (value) => value,
  selectList: {
    selectedPrefix: (value) => value,
    selectedText: (value) => value,
    description: (value) => value,
    scrollInfo: (value) => value,
    noMatch: (value) => value,
  },
};

const testTerminal: Terminal = {
  columns: 80,
  rows: 24,
  kittyProtocolActive: false,
  start: () => {},
  stop: () => {},
  drainInput: async () => {},
  write: () => {},
  moveBy: () => {},
  hideCursor: () => {},
  showCursor: () => {},
  clearLine: () => {},
  clearFromCursor: () => {},
  clearScreen: () => {},
  setTitle: () => {},
  setProgress: () => {},
};

function createTestEditor(provider: AutocompleteProvider): ChumpEditor {
  const editor = new ChumpEditor(
    new TuiMainScreen(testTerminal),
    testEditorTheme,
    [],
  );
  editor.setAutocompleteProvider(provider);
  return editor;
}

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function sessionSummary(
  id: string,
  title: string,
  updatedAt: number,
): SessionSummary {
  return {
    id,
    active: false,
    message_count: 0,
    event_count: 0,
    title,
    created_at: updatedAt,
    updated_at: updatedAt,
    last_user_goal: null,
    last_activity: null,
    connections: 0,
  };
}
