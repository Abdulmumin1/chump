import {
  renderCommand,
  renderCommandOutput,
  renderFileEditDiff,
  renderToolDone,
  renderToolResult,
  type FileEditDiff,
} from "./render.ts";

export class ToolActivityRenderer {
  private readonly writeLine: (value?: string) => void;

  private pendingTools: Array<{
    name: string;
    args: string;
    preRendered?: boolean;
  }> = [];

  private activity = false;

  constructor(writeLine: (value?: string) => void) {
    this.writeLine = writeLine;
  }

  consumeActivity(): boolean {
    const hadActivity = this.activity;
    this.activity = false;
    return hadActivity;
  }

  renderToolCall(payload: Record<string, unknown>): void {
    const toolName = readToolName(payload);
    const label = displayToolName(toolName);
    const renderedArgs = formatToolArgs(
      toolName,
      payload.args ?? payload.payload,
    );
    if (toolName === "bash") {
      this.writeLine(`\n${renderCommand(renderedArgs)}`);
      this.activity = true;
      return;
    }
    if (
      toolName === "read_file" ||
      toolName === "web_fetch" ||
      toolName === "website"
    ) {
      this.writeLine(`\n${renderToolDone(label, renderedArgs)}`);
      this.activity = true;
      this.pendingTools.push({ name: toolName, args: renderedArgs });
      return;
    }
    // For apply_patch and write_file/create_file, render the diff from args
    // immediately (used during replay from stored messages where result metadata
    // is not available).
    const argsDiff = readArgsDiffs(toolName, payload.args ?? payload.payload);
    if (argsDiff.length > 0) {
      this.writeLine(
        `\n${argsDiff.map((diff) => renderFileEditDiff(diff)).join("\n")}`,
      );
      this.activity = true;
      this.pendingTools.push({
        name: toolName,
        args: renderedArgs,
        preRendered: true,
      });
      return;
    }
    this.pendingTools.push({ name: toolName, args: renderedArgs });
  }

  renderToolResult(payload: Record<string, unknown>): void {
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
    if (toolName === "bash") {
      this.writeLine(renderCommandOutput(ok, truncatePreview(preview, 500)));
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
      this.takePendingTool(toolName);
      // Structured metadata diffs are authoritative — always render them.
      // (During live streaming, this replaces the args-based pre-render.)
      this.writeLine(
        `\n${diffs.map((diff) => renderFileEditDiff(diff)).join("\n")}`,
      );
      this.activity = true;
      return;
    }

    const pending = this.takePendingTool(toolName);
    // If already pre-rendered from args (replay: no result metadata available), skip
    if (pending?.preRendered) {
      this.activity = true;
      return;
    }
    if (
      ok === "ok" &&
      (toolName === "read_file" ||
        toolName === "web_fetch" ||
        toolName === "website")
    ) {
      return;
    }

    if (ok === "ok" && pending) {
      this.writeLine(`\n${renderToolDone(label, pending.args)}`);
      this.activity = true;
      return;
    }

    this.writeLine(`\n${renderToolResult(ok, label, preview)}`);
    this.activity = true;
  }

  private takePendingTool(name: string): {
    name: string;
    args: string;
    preRendered?: boolean;
  } | null {
    const index = this.pendingTools.findIndex((tool) => tool.name === name);
    if (index === -1) {
      return null;
    }
    const [tool] = this.pendingTools.splice(index, 1);
    return tool ?? null;
  }
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

function displayToolName(name: string): string {
  if (name === "web_fetch") {
    return "fetch";
  }
  if (name === "website") {
    return "web search";
  } else if (name === "read_file") {
    return "Read";
  }
  return name;
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

  if (toolName === "apply_patch" && typeof a.patch_text === "string") {
    return parsePatchTextDiffs(a.patch_text);
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
