import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AutocompleteProvider,
  type EditorTheme,
  TUI,
  type Terminal,
  visibleWidth,
} from "@earendil-works/pi-tui";

import type { SessionSummary } from "../core/types.ts";
import { ChumpAutocompleteProvider } from "./tui/autocomplete.ts";
import {
  MutableLines,
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
  assert.doesNotMatch(collapsed, /line 12/u);
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
  assert.doesNotMatch(collapsed, new RegExp(outputTail, "u"));

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
  assert.match(stripTestAnsi(transcript.render(80).join("\n")), /first private thought/u);

  transcript.setThinkingVisible(false);
  assert.doesNotMatch(stripTestAnsi(transcript.render(80).join("\n")), /first private thought/u);

  transcript.appendReasoning("second private thought");
  assert.doesNotMatch(stripTestAnsi(transcript.render(80).join("\n")), /second private thought/u);

  transcript.setThinkingVisible(true);
  const visible = stripTestAnsi(transcript.render(80).join("\n"));
  assert.match(visible, /first private thought/u);
  assert.match(visible, /second private thought/u);
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
  const editor = new ChumpEditor(new TUI(testTerminal), testEditorTheme, []);
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
