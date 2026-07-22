import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

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
  renderTuiMuted,
  renderUserMessage,
} from "./render.ts";
import {
  registerTuiExtension,
  resolveTuiExtensions,
} from "./tui/extensions.ts";

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
    ["/share", "/share status", "/share stop"],
  );
  assert.equal(
    provider.shouldTriggerFileCompletion(["/share "], 0, 7),
    true,
  );
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
