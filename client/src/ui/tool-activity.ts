import {
  renderCommand,
  renderCommandOutput,
  renderFileChangeSummary,
  renderFileEditDiff,
  renderLiveActivity,
  renderToolDone,
  renderToolResult,
  type FileEditDiff,
  renderMuted,
} from "./render.ts";

export class ToolActivityRenderer {
  private readonly writeLine: (value?: string) => void;
  private capturedOutput: string[] | null = null;

  private pendingTools: Array<{
    name: string;
    args: string;
    key?: string;
    step: number | null;
    index: number | null;
    deferredDiffs?: FileEditDiff[];
  }> = [];
  private readonly bufferedParallelResults = new Map<
    number,
    Array<{ index: number; output: string[] }>
  >();
  private readonly completedTools = new Set<string>();
  private readonly streamingCalls = new Map<
    string,
    { name: string; argumentsText: string }
  >();

  private activity = false;
  private compactToolRunActive = false;

  constructor(writeLine: (value?: string) => void) {
    this.writeLine = writeLine;
  }

  consumeActivity(): boolean {
    const hadActivity = this.activity;
    this.activity = false;
    // Consumers call this when non-tool content is about to render. That
    // content ends the compact run, so a later tool starts a new spaced block
    // instead of being visually grouped across the intervening text.
    this.compactToolRunActive = false;
    return hadActivity;
  }

  renderToolCall(payload: Record<string, unknown>): string {
    const toolName = readToolName(payload);
    const key = readToolIdentity(payload);
    if (key) {
      this.streamingCalls.delete(key);
      this.completedTools.delete(key);
      this.pendingTools = this.pendingTools.filter((tool) => tool.key !== key);
    }
    const label = displayToolName(toolName);
    const renderedArgs = formatToolArgs(
      toolName,
      payload.args ?? payload.payload,
    );
    if (toolName === "bash") {
      // Keep the permanent command and its output together when the result
      // arrives. The status row still previews the command live while its
      // arguments stream and while it executes.
      this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
      this.activity = true;
      return formatReadyToolPreview(toolName, payload.args ?? payload.payload);
    }
    if (
      toolName === "read_file" ||
      toolName === "web_fetch" ||
      toolName === "website"
    ) {
      // The status row previews these while they run. Defer the permanent row
      // until completion so a failed call replaces its pending state instead
      // of looking like one successful call followed by a second failed call.
      this.activity = true;
      this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
      return formatReadyToolPreview(toolName, payload.args ?? payload.payload);
    }
    if (toolName === "search") {
      // Defer to result — no call line rendered.
      this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
      return formatReadyToolPreview(toolName, payload.args ?? payload.payload);
    }
    this.compactToolRunActive = false;
    // For apply_patch and write_file/create_file, keep the diff from args
    // available for replay when result metadata is absent, but do not render it
    // until the result is known to be successful. Failed edits should not leave
    // success-looking diffs in the transcript.
    const argsDiff = readArgsDiffs(toolName, payload.args ?? payload.payload);
    if (argsDiff.length > 0) {
      this.pendingTools.push({
        name: toolName,
        args: renderedArgs,
        key,
        step: finiteNumber(payload.step),
        index: finiteNumber(payload.index),
        deferredDiffs: argsDiff,
      });
      return formatReadyToolPreview(toolName, payload.args ?? payload.payload);
    }
    this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
    return formatReadyToolPreview(toolName, payload.args ?? payload.payload);
  }

  renderToolCallStream(payload: Record<string, unknown>): string | null {
    const key = readToolIdentity(payload);
    if (!key) return null;
    const current = this.streamingCalls.get(key) ?? {
      name: "",
      argumentsText: "",
    };
    const explicitName = readToolName(payload);
    const nameDelta =
      typeof payload.name_delta === "string" ? payload.name_delta : "";
    const argumentsDelta =
      typeof payload.arguments_delta === "string"
        ? payload.arguments_delta
        : "";
    current.name =
      (explicitName === "tool" ? "" : explicitName) ||
      `${current.name}${nameDelta}` ||
      "tool";
    current.argumentsText += argumentsDelta;
    this.streamingCalls.set(key, current);

    const args = parseToolArguments(current.argumentsText) ?? {};
    return formatStreamingToolPreview(current.name, args);
  }

  renderToolResult(payload: Record<string, unknown>): boolean {
    const key = readToolIdentity(payload);
    if (key && this.completedTools.has(key)) {
      return false;
    }
    if (key) {
      this.completedTools.add(key);
    }
    this.renderToolResultInInvocationOrder(payload);
    return true;
  }

  flushPendingBatches(): void {
    for (const step of [...this.bufferedParallelResults.keys()].sort((a, b) => a - b)) {
      this.flushParallelBatch(step);
    }
  }

  private renderToolResultInInvocationOrder(
    payload: Record<string, unknown>,
  ): void {
    const step = finiteNumber(payload.step);
    const index = finiteNumber(payload.index);
    if (step === null || index === null) {
      this.renderToolResultOnce(payload);
      return;
    }

    const pendingInStep = this.pendingTools.filter((tool) => tool.step === step).length;
    const buffered = this.bufferedParallelResults.get(step);
    const isParallel = pendingInStep > 1 || buffered !== undefined;
    if (!isParallel) {
      this.renderToolResultOnce(payload);
      return;
    }

    const previousCompactState = this.compactToolRunActive;
    this.compactToolRunActive = false;
    const output: string[] = [];
    this.capturedOutput = output;
    try {
      this.renderToolResultOnce(payload);
    } finally {
      this.capturedOutput = null;
      this.compactToolRunActive = previousCompactState;
    }

    const batch = buffered ?? [];
    batch.push({ index, output });
    this.bufferedParallelResults.set(step, batch);
    if (!this.pendingTools.some((tool) => tool.step === step)) {
      this.flushParallelBatch(step);
    }
  }

  private flushParallelBatch(step: number): void {
    const batch = this.bufferedParallelResults.get(step);
    if (!batch) {
      return;
    }
    this.bufferedParallelResults.delete(step);
    this.compactToolRunActive = false;
    for (const [resultIndex, result] of batch
      .sort((a, b) => a.index - b.index)
      .entries()) {
      for (const [lineIndex, line] of result.output.entries()) {
        const value = resultIndex > 0 && lineIndex === 0 && line.startsWith("\n")
          ? line.slice(1)
          : line;
        this.writeLine(value);
      }
    }
  }

  private renderToolResultOnce(payload: Record<string, unknown>): void {
    const toolName = readToolName(payload);
    const label = displayToolName(toolName);
    const ok =
      typeof payload.status === "string"
        ? payload.status
        : payload.ok === true
          ? "ok"
          : "error";
    const preview =
      typeof payload.preview === "string"
        ? payload.preview
        : compactJson(payload);
    const visiblePreview = userFacingToolPreview(toolName, ok, preview);
    if (toolName === "bash") {
      this.compactToolRunActive = false;
      const pending = this.takePendingTool(toolName, payload);
      this.emit(`\n${renderCommand(stripHtmlSpans(pending?.args || "command"))}`);
      this.emit(
        renderCommandOutput(
          ok,
          truncateMultilinePreview(
            visiblePreview,
            commandOutputPreviewLimit(),
            5,
          ),
        ),
      );
      this.emit("");
      this.activity = true;
      return;
    }

    if (toolName === "search") {
      const pending = this.takePendingTool(toolName, payload);
      const searchMatches = readSearchMatches(payload);
      const args = pending?.args ?? "";
      const label = displayToolName("search");
      if (ok === "ok" && searchMatches && searchMatches.matches.length > 0) {
        const total =
          searchMatches.totalMatched > 0
            ? searchMatches.totalMatched
            : searchMatches.matches.length;
        const countSuffix = ` (${total} match${total === 1 ? "" : "es"})`;
        this.writeCompactToolLine(
          `${renderToolDone(label, args)}${renderMuted(countSuffix)}`,
        );
        const omitted =
          searchMatches.totalMatched > 0
            ? searchMatches.totalMatched - searchMatches.matches.length
            : 0;
        if (omitted > 0) {
          this.emit(
            `  ${renderMuted(`[${omitted} additional matches omitted]`)}`,
          );
        }
      } else if (ok !== "ok") {
        this.writeCompactToolLine(
          renderToolResult(ok, label, visiblePreview),
        );
      } else {
        this.writeCompactToolLine(
          `${renderToolDone(label, args)}${renderMuted(" (no matches)")}`,
        );
      }
      this.activity = true;
      return;
    }

    const diffs = readFileEditDiffs(payload);
    if (
      ok === "ok" &&
      diffs.length > 0 &&
      (toolName === "write_file" ||
        toolName === "replace_in_file" ||
        toolName === "apply_patch")
    ) {
      this.compactToolRunActive = false;
      this.takePendingTool(toolName, payload);
      // Structured metadata diffs are authoritative — always render them.
      // (During live streaming, this replaces the args-based pre-render.)
      this.emit(
        `\n${diffs.map((diff) => renderFileEditDiff(diff)).join("\n")}`,
      );
      this.emit("");
      this.activity = true;
      return;
    }

    const pending = this.takePendingTool(toolName, payload);
    // Replay fallback: if a successful edit has no structured diff metadata,
    // render the diff captured from the original tool arguments.
    if (ok === "ok" && pending?.deferredDiffs?.length) {
      this.compactToolRunActive = false;
      this.emit(
        `\n${pending.deferredDiffs.map((diff) => renderFileEditDiff(diff)).join("\n")}`,
      );
      this.emit("");
      this.activity = true;
      return;
    }
    if (
      toolName === "read_file" ||
      toolName === "web_fetch" ||
      toolName === "website"
    ) {
      const line = ok === "ok"
        ? renderToolDone(label, pending?.args ?? "")
        : renderToolResult(
          ok,
          label,
          pending?.args || visiblePreview,
        );
      this.writeCompactToolLine(line);
      this.activity = true;
      return;
    }

    if (ok === "ok" && pending) {
      this.compactToolRunActive = false;
      this.emit(`\n${renderToolDone(label, pending.args)}`);
      this.emit("");
      this.activity = true;
      return;
    }

    this.compactToolRunActive = false;
    this.emit(`\n${renderToolResult(ok, label, visiblePreview)}`);
    this.emit("");
    this.activity = true;
  }

  private takePendingTool(name: string, payload: Record<string, unknown>): {
    name: string;
    args: string;
    key?: string;
    step: number | null;
    index: number | null;
    deferredDiffs?: FileEditDiff[];
  } | null {
    const key = readToolIdentity(payload);
    const index = key
      ? this.pendingTools.findIndex((tool) => tool.key === key)
      : this.pendingTools.findIndex((tool) => tool.name === name);
    if (index === -1) {
      return null;
    }
    const [tool] = this.pendingTools.splice(index, 1);
    return tool ?? null;
  }

  private writeCompactToolLine(line: string): void {
    this.emit(this.compactToolRunActive ? line : `\n${line}`);
    this.compactToolRunActive = true;
  }

  private emit(value = ""): void {
    if (this.capturedOutput) {
      this.capturedOutput.push(value);
      return;
    }
    this.writeLine(value);
  }
}

function pendingTool(
  name: string,
  args: string,
  key: string,
  payload: Record<string, unknown>,
): {
  name: string;
  args: string;
  key?: string;
  step: number | null;
  index: number | null;
} {
  return {
    name,
    args,
    key: key || undefined,
    step: finiteNumber(payload.step),
    index: finiteNumber(payload.index),
  };
}

export function readToolName(payload: Record<string, unknown>): string {
  if (typeof payload.name === "string") {
    return payload.name;
  }
  if (typeof payload.tool === "string") {
    return payload.tool;
  }
  if (typeof payload.tool_name === "string") {
    return payload.tool_name;
  }
  return "tool";
}

export function readToolIdentity(payload: Record<string, unknown>): string {
  const step = finiteNumber(payload.step);
  const index = finiteNumber(payload.index);
  if (step !== null && index !== null) {
    return `position:${step}:${index}`;
  }
  const callId = [payload.call_id, payload.tool_call_id, payload.id].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return callId ? `call:${callId}` : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatStreamingToolPreview(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    return renderLiveActivity("Writing command", command || "…");
  }
  if (toolName === "write_file" || toolName === "create_file") {
    const path = stringArgument(args, "path", "file_path") || "…";
    const content = stringArgument(args, "content");
    return renderFileChangeSummary(
      toolName === "create_file" ? "Creating file" : "Writing file",
      path,
      countContentLines(content),
      0,
    );
  }
  if (
    toolName === "apply_patch" ||
    toolName === "replace_in_file" ||
    toolName === "edit_file"
  ) {
    const patch = stringArgument(
      args,
      "patch",
      "patch_text",
      "patchText",
      "diff",
    );
    const counts = countPatchChanges(patch);
    return renderFileChangeSummary(
      "Editing file",
      patchPath(patch) || stringArgument(args, "path", "file_path") || "…",
      counts.added,
      counts.removed,
    );
  }
  return formatSemanticToolPreview(toolName, args);
}

function formatReadyToolPreview(toolName: string, value: unknown): string {
  const args = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  if (toolName === "bash") {
    return renderLiveActivity(
      "Running command",
      stringArgument(args, "command") || "…",
    );
  }
  return formatStreamingToolPreview(toolName, args);
}

function formatSemanticToolPreview(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const renderedArgs = formatToolArgs(toolName, args) || "…";
  const label = semanticToolLabel(toolName);
  return renderLiveActivity(label, renderedArgs);
}

function semanticToolLabel(toolName: string): string {
  switch (toolName) {
    case "read_file":
      return "Reading file";
    case "view_image":
      return "Viewing image";
    case "search":
      return "Searching files";
    case "web_fetch":
      return "Fetching page";
    case "website":
      return "Searching web";
    case "skill":
    case "load_skill":
      return "Loading skill";
    case "list_sessions":
      return "Listing sessions";
    case "inspect_session":
      return "Inspecting session";
    case "start_session":
      return "Starting session";
    default:
      return `Running ${displayToolName(toolName)}`;
  }
}

function stringArgument(
  args: Record<string, unknown>,
  ...names: string[]
): string {
  for (const name of names) {
    if (typeof args[name] === "string") return args[name];
  }
  return "";
}

function countContentLines(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\r\n?/g, "\n");
  const trailingNewline = normalized.endsWith("\n") ? 1 : 0;
  return normalized.split("\n").length - trailingNewline;
}

function countPatchChanges(value: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function patchPath(value: string): string {
  const marker = /\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/.exec(value);
  if (marker?.[1]) return marker[1].trim();
  const unified = /^\+\+\+ (?:b\/)?([^\n]+)/m.exec(value);
  return unified?.[1]?.trim() ?? "";
}

function parseToolArguments(value: string): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return parsePartialJsonObject(value);
  }
}

function parsePartialJsonObject(value: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  let cursor = skipWhitespace(value, 0);
  if (value[cursor] !== "{") return null;
  cursor += 1;

  while (cursor < value.length) {
    cursor = skipWhitespaceAndCommas(value, cursor);
    if (value[cursor] !== '"') break;
    const key = readJsonString(value, cursor, false);
    if (!key.complete) break;
    cursor = skipWhitespace(value, key.end);
    if (value[cursor] !== ":") break;
    cursor = skipWhitespace(value, cursor + 1);
    if (value[cursor] !== '"') break;
    const field = readJsonString(value, cursor, true);
    result[key.value] = field.value;
    cursor = field.end;
    if (!field.complete) break;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function readJsonString(
  source: string,
  start: number,
  allowPartial: boolean,
): { value: string; end: number; complete: boolean } {
  let value = "";
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor] ?? "";
    if (character === '"') {
      return { value, end: cursor + 1, complete: true };
    }
    if (character !== "\\") {
      value += character;
      cursor += 1;
      continue;
    }
    const escaped = source[cursor + 1];
    if (escaped === undefined) break;
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped === "u") {
      const hex = source.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      cursor += 6;
      continue;
    }
    value += simpleEscapes[escaped] ?? escaped;
    cursor += 2;
  }
  return {
    value: allowPartial ? value : "",
    end: source.length,
    complete: false,
  };
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipWhitespaceAndCommas(source: string, start: number): number {
  let cursor = start;
  while (/\s|,/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function displayToolName(name: string): string {
  const knownNames: Record<string, string> = {
    apply_patch: "Apply patch",
    bash: "Command",
    create_file: "Create file",
    edit_file: "Edit file",
    inspect_session: "Inspect session",
    list_sessions: "List sessions",
    load_skill: "Skill",
    read_file: "Read",
    replace_in_file: "Edit file",
    search: "Search",
    skill: "Skill",
    start_session: "Start session",
    view_image: "View image",
    web_fetch: "Fetch",
    website: "Web search",
    write_file: "Write file",
  };
  const knownName = knownNames[name];
  if (knownName) {
    return knownName;
  }

  const readable = name.replace(/[_-]+/gu, " ").trim();
  return readable
    ? `${readable[0]?.toUpperCase() ?? ""}${readable.slice(1)}`
    : "Tool";
}

export function formatToolArgs(toolName: string, value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const args = value as Record<string, unknown>;
  if (toolName === "read_file") {
    const path = typeof args.path === "string" ? args.path : "";
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const range = [
      offset !== undefined ? `offset=${offset}` : null,
      limit !== undefined ? `limit=${limit}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return [path, range].filter(Boolean).join(" ");
  }

  if (toolName === "view_image") {
    return typeof args.path === "string" ? args.path : "";
  }

  if (toolName === "bash") {
    return typeof args.command === "string" ? args.command : "";
  }

  if (toolName === "apply_patch") {
    return "";
  }

  if (toolName === "web_fetch") {
    return typeof args.url === "string" ? args.url : "";
  }

  if (toolName === "website") {
    return typeof args.query === "string" ? args.query : "";
  }

  if (toolName === "skill") {
    const name = skillDisplayName(typeof args.name === "string" ? args.name : "");
    return name;
  }

  if (toolName === "load_skill") {
    const name = skillDisplayName(typeof args.name === "string" ? args.name : "");
    return name;
  }

  if (toolName === "search") {
    const query = typeof args.query === "string" ? args.query : "";
    const path = typeof args.path === "string" && args.path ? args.path : null;
    const parts = [
      query ? `"${query}"` : null,
      path ? `in ${path}` : null,
    ].filter(Boolean);
    return parts.join(" ");
  }

  if (toolName === "list_sessions") {
    const page = typeof args.page === "number" && args.page > 1 ? `page ${args.page}` : "";
    const limit = typeof args.limit === "number" ? `limit=${args.limit}` : "";
    return [page, limit].filter(Boolean).join(" ");
  }

  if (toolName === "inspect_session") {
    const sessionId = typeof args.session_id === "string" ? args.session_id : "";
    const messages = args.include_messages === true ? "with messages" : "";
    return [sessionId, messages].filter(Boolean).join(" ");
  }

  if (toolName === "start_session") {
    const sessionId = typeof args.session_id === "string" ? args.session_id : "";
    const prompt = typeof args.prompt === "string" ? args.prompt.trim().replace(/\s+/g, " ") : "";
    return [sessionId, prompt ? `“${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}”` : ""]
      .filter(Boolean)
      .join(" ");
  }

  return compactJson(value);
}

export function compactJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (!encoded) {
    return "";
  }
  if (encoded.length <= 120) {
    return encoded;
  }
  return `${encoded.slice(0, 117)}...`;
}

type FileEditDiffPayload = {
  path: string;
  kind?: "add" | "update" | "delete" | "move";
  sourcePath?: string | null;
  added: number;
  removed: number;
  changes?: Array<{
    type: "add" | "remove";
    oldLine: number | null;
    newLine: number | null;
    text: string;
  }>;
  lines?: string[];
  truncated: boolean;
  shownChanges?: number;
  totalChanges?: number;
};

function readFileEditDiff(value: unknown): FileEditDiffPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const diff = value as Record<string, unknown>;
  if (
    typeof diff.path !== "string" ||
    typeof diff.added !== "number" ||
    typeof diff.removed !== "number"
  ) {
    return null;
  }
  const changes = Array.isArray(diff.changes)
    ? diff.changes.map(readFileEditChange).filter((change) => change !== null)
    : undefined;
  const lines = Array.isArray(diff.lines)
    ? diff.lines.filter((line): line is string => typeof line === "string")
    : undefined;
  return {
    path: diff.path,
    kind:
      diff.kind === "add" ||
      diff.kind === "update" ||
      diff.kind === "delete" ||
      diff.kind === "move"
        ? diff.kind
        : undefined,
    sourcePath: typeof diff.source_path === "string" ? diff.source_path : null,
    added: diff.added,
    removed: diff.removed,
    changes,
    lines,
    truncated: diff.truncated === true,
    shownChanges:
      typeof diff.shown_changes === "number" ? diff.shown_changes : undefined,
    totalChanges:
      typeof diff.total_changes === "number" ? diff.total_changes : undefined,
  };
}

function readFileEditChange(value: unknown): {
  type: "add" | "remove";
  oldLine: number | null;
  newLine: number | null;
  text: string;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const change = value as Record<string, unknown>;
  if (
    (change.type !== "add" && change.type !== "remove") ||
    typeof change.text !== "string"
  ) {
    return null;
  }
  return {
    type: change.type,
    oldLine: typeof change.old_line === "number" ? change.old_line : null,
    newLine: typeof change.new_line === "number" ? change.new_line : null,
    text: change.text,
  };
}

function readFileEditDiffs(
  payload: Record<string, unknown>,
): FileEditDiffPayload[] {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const value = metadata as Record<string, unknown>;
  const files = Array.isArray(value.files)
    ? value.files.map(readFileEditDiff).filter((diff) => diff !== null)
    : [];
  if (files.length > 0) {
    return files;
  }

  const diff = readFileEditDiff(value.diff);
  return diff ? [diff] : [];
}

/**
 * Build FileEditDiff objects from tool call arguments, used during replay
 * from stored messages when result metadata with structured diffs is absent.
 *
 * - apply_patch: parse patch_text as a unified diff, one entry per "*** Update/Add/Delete File:" section
 * - write_file / create_file: synthesize an "add" diff from path + content
 */
function readArgsDiffs(toolName: string, args: unknown): FileEditDiff[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const a = args as Record<string, unknown>;

  const patchText = stringArgument(a, "patch_text", "patchText", "patch");
  if (toolName === "apply_patch" && patchText) {
    return parsePatchTextDiffs(patchText);
  }

  if (
    (toolName === "write_file" || toolName === "create_file") &&
    typeof a.path === "string" &&
    typeof a.content === "string"
  ) {
    const lines = a.content.split("\n").map((l) => `+${l}`);
    return [
      {
        path: a.path,
        kind: "add",
        added: lines.length,
        removed: 0,
        lines,
        truncated: false,
      },
    ];
  }

  return [];
}

/**
 * Parse a patch_text string into per-file FileEditDiff objects using the
 * `lines` format (raw unified-diff lines starting with +/-/@@).
 * Handles "*** Update File:", "*** Add File:", "*** Delete File:" sections.
 */
function parsePatchTextDiffs(patchText: string): FileEditDiff[] {
  const diffs: FileEditDiff[] = [];
  const sectionRe = /^\*{3}\s+(Update|Add|Delete)\s+File:\s*(.+)$/i;

  let currentPath: string | null = null;
  let currentKind: "add" | "update" | "delete" = "update";
  let currentRawLines: string[] = [];

  function flush() {
    if (currentPath === null) return;
    const normalized = normalizeHunkLines(currentRawLines);
    const addedCount = normalized.filter((l) => l.startsWith("+")).length;
    const removedCount = normalized.filter((l) => l.startsWith("-")).length;
    diffs.push({
      path: currentPath,
      kind: currentKind,
      added: addedCount,
      removed: removedCount,
      lines: normalized,
      truncated: false,
    });
  }

  for (const line of patchText.split("\n")) {
    const sectionMatch = sectionRe.exec(line);
    if (sectionMatch) {
      flush();
      currentKind =
        sectionMatch[1]?.toLowerCase() === "add"
          ? "add"
          : sectionMatch[1]?.toLowerCase() === "delete"
            ? "delete"
            : "update";
      currentPath = (sectionMatch[2] ?? "").trim();
      currentRawLines = [];
      continue;
    }
    if (currentPath !== null) {
      currentRawLines.push(line);
    }
  }
  flush();

  return diffs;
}

/**
 * Normalize chump-style hunk lines into standard unified diff format.
 * Chump uses bare `@@` markers; we compute proper `@@ -old,count +new,count @@`
 * so that line numbers can be tracked during rendering.
 * If the lines already have standard `@@ -N` markers they are passed through.
 */
function normalizeHunkLines(lines: string[]): string[] {
  // Already standard unified diff — pass through
  if (lines.some((l) => /^@@\s+-\d/.test(l))) {
    return lines;
  }

  const out: string[] = [];
  let currentHunk: string[] = [];
  let oldStart = 1;
  let newStart = 1;

  function flushHunk() {
    if (currentHunk.length === 0) return;
    const oldCount = currentHunk.filter(
      (l) => !l.startsWith("+") && !l.startsWith("\\"),
    ).length;
    const newCount = currentHunk.filter(
      (l) => !l.startsWith("-") && !l.startsWith("\\"),
    ).length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    out.push(...currentHunk);
    oldStart += oldCount;
    newStart += newCount;
    currentHunk = [];
  }

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flushHunk();
      continue;
    }
    currentHunk.push(line);
  }
  flushHunk();

  return out;
}

function truncatePreview(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 16)} ...[truncated]`;
}

function userFacingToolPreview(
  toolName: string,
  status: string,
  preview: string,
): string {
  if (status === "error" && toolName === "apply_patch") {
    const [firstLine = "apply_patch failed"] = preview.split("\n", 1);
    return firstLine;
  }
  return preview;
}

function skillDisplayName(value: string): string {
  const match = /<skill_content\s+name=["']([^"']+)["']/.exec(value);
  return match?.[1]?.trim() || value;
}

function truncateMultilinePreview(
  value: string,
  limit: number,
  maxLines: number,
): string {
  const normalized = value.replace(/\r\n/g, "\n");
  let rawLines = normalized.split("\n");
  let serverTruncatedCount = 0;

  if (rawLines.length > 0 && rawLines[0].startsWith("...[command output truncated")) {
    const noticeLine = rawLines[0];
    rawLines.shift();
    if (rawLines.length > 0 && rawLines[0] === "") {
      rawLines.shift();
    }
    const match = /showing last (\d+) of (\d+) lines/u.exec(noticeLine);
    if (match) {
      const shown = Number.parseInt(match[1], 10);
      const total = Number.parseInt(match[2], 10);
      serverTruncatedCount = total - shown;
    }
  }

  if (rawLines.length > 0 && rawLines[rawLines.length - 1].includes("[truncated]")) {
    rawLines.pop();
  }

  const lines = rawLines.map((line) => {
    const cleaned = stripHtmlSpans(line);
    const lineMatch = /^(\d+):\s?(.*)/u.exec(cleaned);
    if (lineMatch) {
      const lineNum = lineMatch[1];
      const content = lineMatch[2];
      return content ? `${lineNum}  ${content}` : lineNum;
    }
    return cleaned;
  });

  const lineLimit = maxLines;
  const totalLinesLength = lines.length;
  const lineTruncated = totalLinesLength > lineLimit;
  let visibleLines = lines.slice(0, lineLimit);

  let truncatedCount = serverTruncatedCount;
  if (lineTruncated) {
    truncatedCount += totalLinesLength - lineLimit;
  }

  const joinedVisible = visibleLines.join("\n");
  if (joinedVisible.length > limit) {
    return joinedVisible.slice(0, limit - 16) + " ...[truncated]";
  }

  if (truncatedCount > 0) {
    visibleLines.push("");
    visibleLines.push(`... +${truncatedCount.toLocaleString()} lines truncated`);
  }

  return visibleLines.join("\n");
}

function stripHtmlSpans(value: string): string {
  return value.replace(/<\/?span\b[^>]*>/giu, "");
}

function commandOutputPreviewLimit(): number {
  const columns = process.stdout.columns ?? 80;
  const treeIndentWidth = 5;
  return Math.max(240, Math.min(1200, (columns - treeIndentWidth) * 5));
}

function readSearchMatch(value: unknown): SearchMatch | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const m = value as Record<string, unknown>;
  if (
    typeof m.path !== "string" ||
    typeof m.line !== "number" ||
    typeof m.column !== "number" ||
    typeof m.text !== "string"
  ) {
    return null;
  }
  return {
    path: m.path,
    line: m.line,
    column: m.column,
    text: m.text,
  };
}

type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

type SearchMatches = {
  matches: SearchMatch[];
  totalMatched: number;
  totalFiles: number;
};

function readSearchMatches(
  payload: Record<string, unknown>,
): SearchMatches | null {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const m = metadata as Record<string, unknown>;
  const matches = Array.isArray(m.matches)
    ? m.matches
        .map(readSearchMatch)
        .filter((x): x is SearchMatch => x !== null)
    : [];
  const totalMatched =
    typeof m.totalMatched === "number" ? m.totalMatched : matches.length;
  return { matches, totalMatched, totalFiles: 0 };
}
