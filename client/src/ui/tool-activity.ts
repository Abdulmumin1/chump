import path from "node:path";

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
import {
  type CommandActivity,
  formatCommandOutput,
} from "./command-activity.ts";

type ToolActivityEmission =
  | { type: "line"; value: string }
  | { type: "command"; activity: CommandActivity }
  | { type: "compact"; activity: CompactActivityEmission };

export type CompactActivityEmission = { toolName: string, label: string, status: string, args: string, preview: string, fallbackLine: string };

export class ToolActivityRenderer {
  private readonly writeLine: (value?: string) => void;
  private readonly writeCommandActivity:
    | ((activity: CommandActivity) => boolean)
    | null;
  private readonly writeCompactActivity:
    | ((activity: CompactActivityEmission) => boolean)
    | null;
  private workspaceRoot: string;

  private pendingTools: Array<{
    name: string;
    args: string;
    key?: string;
    step: number | null;
    index: number | null;
    deferredDiffs?: FileEditDiff[];
  }> = [];
  private readonly completedTools = new Set<string>();
  private readonly streamingCalls = new Map<
    string,
    { name: string; argumentsText: string }
  >();

  private activity = false;
  private compactToolRunActive = false;

  constructor(
    writeLine: (value?: string) => void,
    writeCommandActivity: ((activity: CommandActivity) => boolean) | null = null,
    writeCompactActivityOrWorkspaceRoot:
      | ((activity: CompactActivityEmission) => boolean)
      | string
      | null = null,
    workspaceRoot = process.cwd(),
  ) {
    this.writeLine = writeLine;
    this.writeCommandActivity = writeCommandActivity;
    if (typeof writeCompactActivityOrWorkspaceRoot === "function") {
      this.writeCompactActivity = writeCompactActivityOrWorkspaceRoot;
      this.workspaceRoot = path.resolve(workspaceRoot);
    } else if (typeof writeCompactActivityOrWorkspaceRoot === "string") {
      this.writeCompactActivity = null;
      this.workspaceRoot = path.resolve(writeCompactActivityOrWorkspaceRoot);
    } else {
      this.writeCompactActivity = null;
      this.workspaceRoot = path.resolve(workspaceRoot);
    }
  }

  setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = path.resolve(workspaceRoot);
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
      this.pendingTools = this.pendingTools.filter((tool) => tool.key !== key);
    }
    const callId = readToolCallId(payload);
    if (callId) {
      this.completedTools.delete(callId);
    }
    const label = displayToolName(toolName);
    const renderedArgs = formatToolArgs(
      toolName,
      payload.args ?? payload.payload,
      this.workspaceRoot,
    );
    if (toolName === "bash") {
      // Keep the permanent command and its output together when the result
      // arrives. The status row still previews the command live while its
      // arguments stream and while it executes.
      this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
      this.activity = true;
      return formatReadyToolPreview(
        toolName,
        payload.args ?? payload.payload,
        this.workspaceRoot,
      );
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
      return formatReadyToolPreview(
        toolName,
        payload.args ?? payload.payload,
        this.workspaceRoot,
      );
    }
    if (toolName === "search") {
      // Defer to result — no call line rendered.
      this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
      return formatReadyToolPreview(
        toolName,
        payload.args ?? payload.payload,
        this.workspaceRoot,
      );
    }
    this.compactToolRunActive = false;
    // For apply_patch and write_file/create_file, keep the diff from args
    // available for replay when result metadata is absent, but do not render it
    // until the result is known to be successful. Failed edits should not leave
    // success-looking diffs in the transcript.
    const argsDiff = readArgsDiffs(
      toolName,
      payload.args ?? payload.payload,
      this.workspaceRoot,
    );
    if (argsDiff.length > 0) {
      this.pendingTools.push({
        name: toolName,
        args: renderedArgs,
        key,
        step: finiteNumber(payload.step),
        index: finiteNumber(payload.index),
        deferredDiffs: argsDiff,
      });
      return formatReadyToolPreview(
        toolName,
        payload.args ?? payload.payload,
        this.workspaceRoot,
      );
    }
    this.pendingTools.push(pendingTool(toolName, renderedArgs, key, payload));
    return formatReadyToolPreview(
      toolName,
      payload.args ?? payload.payload,
      this.workspaceRoot,
    );
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
    return formatStreamingToolPreview(current.name, args, this.workspaceRoot);
  }

  renderToolResult(payload: Record<string, unknown>): boolean {
    // Results are deduplicated by tool call id. The server emits both
    // tool_execution.finished and the correlated tool_result for the same
    // call; the first one wins. Position-based keys (step/index) reset every
    // turn and would silently drop unrelated results that reuse the slot.
    const callId = readToolCallId(payload);
    if (callId && this.completedTools.has(callId)) {
      return false;
    }
    if (callId) {
      this.completedTools.add(callId);
    }
    this.renderToolResultOnce(payload);
    return true;
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
    if (toolName === "start_session") {
      this.takePendingTool(toolName, payload);
      const sessionId = readStartedSessionId(payload) ?? "delegated session";
      const resultPreview = readStartedSessionResultPreview(payload) ??
        (ok === "ok" ? "Completed" : visiblePreview);
      const detail = [sessionId, resultPreview].filter(Boolean).join(" · ");
      this.writeCompactEmission({
        toolName,
        label: "Session",
        status: ok,
        args: sessionId,
        preview: resultPreview,
        fallbackLine: renderToolResult(ok, "Session", detail),
      });
      this.activity = true;
      return;
    }
    if (toolName === "search_models") {
      const pending = this.takePendingTool(toolName, payload);
      const summary = ok === "ok"
        ? searchModelsResultSummary(visiblePreview)
        : visiblePreview.split("\n", 1)[0] ?? "Search models failed";
      const detail = [pending?.args, summary].filter(Boolean).join(" · ");
      this.writeCompactEmission({
        toolName,
        label,
        status: ok,
        args: pending?.args ?? "",
        preview: detail,
        fallbackLine: renderToolResult(ok, label, detail),
      });
      this.activity = true;
      return;
    }
    if (toolName === "bash") {
      this.compactToolRunActive = false;
      const pending = this.takePendingTool(toolName, payload);
      this.emitCommand({
        command: stripHtmlSpans(pending?.args || "command"),
        status: ok,
        preview: visiblePreview,
        displayOutput:
          typeof payload.display_output === "string"
            ? payload.display_output
            : null,
      });
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
        const preview = `${args}${countSuffix}`;
        this.writeCompactEmission(
          { toolName: "search", label, status: ok, args, preview, fallbackLine: `${renderToolDone(label, args)}${renderMuted(countSuffix)}` }
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
        this.writeCompactEmission(
          { toolName: "search", label, status: ok, args, preview: visiblePreview, fallbackLine: renderToolResult(ok, label, visiblePreview) }
        );
      } else {
        this.writeCompactEmission(
          { toolName: "search", label, status: ok, args, preview: `${args} (no matches)`, fallbackLine: `${renderToolDone(label, args)}${renderMuted(" (no matches)")}` }
        );
      }
      this.activity = true;
      return;
    }

    const diffs = readFileEditDiffs(payload, this.workspaceRoot);
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
      this.writeCompactEmission({
        toolName,
        label,
        status: ok,
        args: pending?.args ?? "",
        preview: ok === "ok" ? pending?.args ?? "" : pending?.args || visiblePreview,
        fallbackLine: line,
      });
      this.activity = true;
      return;
    }

    if (ok === "ok" && pending) {
      this.compactToolRunActive = false;
      const resultLine =
        typeof payload.preview === "string" && payload.preview.length > 0
          ? renderToolResult(
              ok,
              label,
              [pending.args, visiblePreview].filter(Boolean).join(" "),
            )
          : renderToolDone(label, pending.args);
      this.emit(`\n${resultLine}`);
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

  private writeCompactEmission(activity: CompactActivityEmission): void {
    this.emitCompact(activity);
  }

  private writeCompactToolLine(line: string): void {
    this.emit(this.compactToolRunActive ? line : `\n${line}`);
    this.compactToolRunActive = true;
  }

  private emit(value = ""): void {
    this.writeLine(value);
  }

  private emitCompact(activity: CompactActivityEmission): void {
    this.writeEmission({ type: "compact", activity });
  }

  private emitCommand(activity: CommandActivity): void {
    this.writeCommand(activity);
  }

  private writeEmission(emission: ToolActivityEmission): void {
    if (emission.type === "command") {
      this.writeCommand(emission.activity);
      return;
    }
    if (emission.type === "compact") {
      if (!this.writeCompactActivity?.(emission.activity)) {
        this.writeCompactToolLine(emission.activity.fallbackLine);
      }
      return;
    }
    this.writeLine(emission.value);
  }

  private writeCommand(activity: CommandActivity): void {
    if (this.writeCommandActivity?.(activity)) {
      return;
    }
    this.writeLine(`\n${renderCommand(activity.command)}`);
    this.writeLine(
      renderCommandOutput(
        activity.status,
        formatCommandOutput(
          activity.displayOutput ?? activity.preview,
          commandOutputPreviewLimit(),
          5,
        ),
      ),
    );
    this.writeLine("");
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
  const callId = readToolCallId(payload);
  return callId ? `call:${callId}` : "";
}

export function readToolCallId(payload: Record<string, unknown>): string | null {
  return [payload.call_id, payload.tool_call_id, payload.id].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  ) ?? null;
}

/** Return the child session id carried by a start_session call or result. */
export type StartedSessionPayload = {
  name: "start_session";
  args?: StartedSessionArguments;
  payload?: StartedSessionArguments;
  result?: StartedSessionResult;
  preview?: string;
};

type StartedSessionArguments = {
  session_id?: string;
  prompt?: string;
  provider?: string;
  model?: string;
};

type StartedSessionResult = {
  session_id?: string;
  response?: string;
  provider?: string;
  model?: string;
  delegated_task_status?: string;
  error?: string;
};

export function readStartedSessionId(
  value: unknown,
): string | null {
  const payload = parseStartedSessionPayload(value);
  if (!payload) {
    return null;
  }

  const args = payload.args ?? payload.payload;
  const argumentId = args?.session_id;
  if (typeof argumentId === "string" && argumentId.trim()) {
    return argumentId.trim();
  }

  const resultObject = resultObjectFrom(payload.result ?? payload.preview);
  const resultId = resultObject?.session_id;
  return typeof resultId === "string" && resultId.trim()
    ? resultId.trim()
    : null;
}

/** Return a compact user-facing result from a completed delegated session. */
export function readStartedSessionResultPreview(value: unknown): string | null {
  const payload = parseStartedSessionPayload(value);
  if (!payload) {
    return null;
  }

  const resultPreview = payload.result?.response ?? payload.result?.error;
  const plainPreview = payload.preview && !payload.preview.trimStart().startsWith("{")
    ? payload.preview
    : null;
  const preview = resultPreview ?? plainPreview;
  if (!preview) {
    return null;
  }

  const compact = preview.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return null;
  }
  return compact.length > 180
    ? `${compact.slice(0, 179).trimEnd()}…`
    : compact;
}

type StartedSessionCandidate = {
  name?: unknown;
  tool?: unknown;
  tool_name?: unknown;
  args?: unknown;
  payload?: unknown;
  result?: unknown;
  preview?: unknown;
};

type StartedSessionArgumentsCandidate = {
  session_id?: unknown;
  prompt?: unknown;
  provider?: unknown;
  model?: unknown;
};

export function parseStartedSessionPayload(value: unknown): StartedSessionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as StartedSessionCandidate;
  const name = [candidate.name, candidate.tool, candidate.tool_name].find(
    (item) => item === "start_session",
  );
  if (name !== "start_session") {
    return null;
  }
  const args = startedSessionArgumentsFrom(candidate.args);
  const payload = startedSessionArgumentsFrom(candidate.payload);
  const result = resultObjectFrom(
    typeof candidate.result === "string" || isStartedSessionResult(candidate.result)
      ? candidate.result
      : typeof candidate.preview === "string"
        ? candidate.preview
        : undefined,
  );
  return {
    name: "start_session",
    args: args ?? undefined,
    payload: payload ?? undefined,
    result: result ?? undefined,
    preview: typeof candidate.preview === "string" ? candidate.preview : undefined,
  };
}

function startedSessionArgumentsFrom(value: unknown): StartedSessionArguments | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as StartedSessionArgumentsCandidate;
  return {
    session_id: optionalString(candidate.session_id),
    prompt: optionalString(candidate.prompt),
    provider: optionalString(candidate.provider),
    model: optionalString(candidate.model),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isStartedSessionResult(value: unknown): value is StartedSessionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return [
    candidate.session_id,
    candidate.response,
    candidate.provider,
    candidate.model,
    candidate.delegated_task_status,
    candidate.error,
  ].some((item) => typeof item === "string");
}

function resultObjectFrom(
  value: unknown,
): StartedSessionResult | null {
  if (isStartedSessionResult(value)) {
    return {
      session_id: optionalString(value.session_id),
      response: optionalString(value.response),
      provider: optionalString(value.provider),
      model: optionalString(value.model),
      delegated_task_status: optionalString(value.delegated_task_status),
      error: optionalString(value.error),
    };
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return resultObjectFrom(parsed);
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatStreamingToolPreview(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): string {
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    return renderLiveActivity("Writing command", command || "…");
  }
  if (toolName === "write_file" || toolName === "create_file") {
    const filePath = displayWorkspacePath(
      stringArgument(args, "path", "file_path"),
      workspaceRoot,
    ) || "…";
    const content = stringArgument(args, "content");
    return renderFileChangeSummary(
      toolName === "create_file" ? "Creating file" : "Writing file",
      filePath,
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
      displayWorkspacePath(
        patchPath(patch) || stringArgument(args, "path", "file_path"),
        workspaceRoot,
      ) || "…",
      counts.added,
      counts.removed,
    );
  }
  return formatSemanticToolPreview(toolName, args, workspaceRoot);
}

function formatReadyToolPreview(
  toolName: string,
  value: unknown,
  workspaceRoot: string,
): string {
  const args = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  if (toolName === "bash") {
    return renderLiveActivity(
      "Running command",
      stringArgument(args, "command") || "…",
    );
  }
  return formatStreamingToolPreview(toolName, args, workspaceRoot);
}

export function formatDelegatedToolPreview(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): string {
  return formatReadyToolPreview(toolName, args, workspaceRoot);
}

function formatSemanticToolPreview(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): string {
  if (toolName === "mcp") {
    return renderLiveActivity("MCP", mcpActivityLabel(args));
  }
  if (toolName === "search_models") {
    return renderLiveActivity(
      semanticToolLabel(toolName),
      formatToolArgs(toolName, args, workspaceRoot),
    );
  }
  const renderedArgs = formatToolArgs(toolName, args, workspaceRoot) || "…";
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
    case "search_models":
      return "Search models";
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
    case "mcp":
      return "MCP";
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
    mcp: "MCP",
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

export function formatToolArgs(
  toolName: string,
  value: unknown,
  workspaceRoot = process.cwd(),
): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const args = value as Record<string, unknown>;
  if (toolName === "mcp") {
    return mcpActivityLabel(args);
  }
  if (toolName === "read_file") {
    const filePath = typeof args.path === "string"
      ? displayWorkspacePath(args.path, workspaceRoot)
      : "";
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const range = [
      offset !== undefined ? `offset=${offset}` : null,
      limit !== undefined ? `limit=${limit}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return [filePath, range].filter(Boolean).join(" ");
  }

  if (toolName === "view_image") {
    return typeof args.path === "string"
      ? displayWorkspacePath(args.path, workspaceRoot)
      : "";
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

  if (toolName === "search_models") {
    return searchModelsActivityLabel(args);
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
    const searchPath = typeof args.path === "string" && args.path
      ? displayWorkspacePath(args.path, workspaceRoot)
      : null;
    const parts = [
      query ? `"${query}"` : null,
      searchPath ? `in ${searchPath}` : null,
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

function displayWorkspacePath(value: string, workspaceRoot: string): string {
  if (!value || !path.isAbsolute(value)) {
    return value;
  }

  const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(value));
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return relativePath === "" ? "." : value;
  }
  return relativePath;
}

function mcpActivityLabel(args: Record<string, unknown>): string {
  const action = typeof args.action === "string" ? args.action : "";
  const server = typeof args.server === "string" ? args.server : "";
  const tool = typeof args.tool_name === "string" ? args.tool_name : "";
  const query = typeof args.query === "string" ? args.query : "";
  const operation: Record<string, string> = {
    status: "Checking status",
    list_tools: "Listing tools",
    search_tools: "Searching tools",
    get_tool: "Getting tool",
    call_tool: "Calling tool",
    add: "Adding server",
    remove: "Removing server",
    reconnect: "Reconnecting server",
  };
  const target = [server, tool].filter(Boolean).join(" / ");
  return [operation[action] ?? "Running", target || query].filter(Boolean).join(" · ");
}

function searchModelsActivityLabel(args: Record<string, unknown>): string {
  const provider = typeof args.provider === "string" ? args.provider.trim() : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  return [provider, query].filter(Boolean).join(" · ");
}

function searchModelsResultSummary(value: string): string {
  let count: number | null = null;
  let providerCount: number | null = null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result = parsed as Record<string, unknown>;
      count = typeof result.count === "number"
        ? result.count
        : Array.isArray(result.models)
          ? result.models.length
          : null;
      providerCount = Array.isArray(result.connected_providers)
        ? result.connected_providers.length
        : null;
    }
  } catch {
    const countMatch = /["']count["']\s*:\s*(\d+)/u.exec(value);
    count = countMatch?.[1] ? Number.parseInt(countMatch[1], 10) : null;
    const providersMatch = /["']connected_providers["']\s*:\s*\[([^\]]*)\]/su.exec(value);
    providerCount = providersMatch?.[1]
      ? [...providersMatch[1].matchAll(/["'][^"']+["']/gu)].length
      : null;
  }

  if (count === null) {
    return "Models found";
  }
  const models = `${count.toLocaleString()} model${count === 1 ? "" : "s"}`;
  if (providerCount === null) {
    return models;
  }
  return `${models} across ${providerCount.toLocaleString()} provider${providerCount === 1 ? "" : "s"}`;
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

function readFileEditDiff(
  value: unknown,
  workspaceRoot: string,
): FileEditDiffPayload | null {
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
    path: displayWorkspacePath(diff.path, workspaceRoot),
    kind:
      diff.kind === "add" ||
      diff.kind === "update" ||
      diff.kind === "delete" ||
      diff.kind === "move"
        ? diff.kind
        : undefined,
    sourcePath: typeof diff.source_path === "string"
      ? displayWorkspacePath(diff.source_path, workspaceRoot)
      : null,
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
  workspaceRoot: string,
): FileEditDiffPayload[] {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const value = metadata as Record<string, unknown>;
  const files = Array.isArray(value.files)
    ? value.files
      .map((file) => readFileEditDiff(file, workspaceRoot))
      .filter((diff) => diff !== null)
    : [];
  if (files.length > 0) {
    return files;
  }

  const diff = readFileEditDiff(value.diff, workspaceRoot);
  return diff ? [diff] : [];
}

/**
 * Build FileEditDiff objects from tool call arguments, used during replay
 * from stored messages when result metadata with structured diffs is absent.
 *
 * - apply_patch: parse patch_text as a unified diff, one entry per "*** Update/Add/Delete File:" section
 * - write_file / create_file: synthesize an "add" diff from path + content
 */
function readArgsDiffs(
  toolName: string,
  args: unknown,
  workspaceRoot: string,
): FileEditDiff[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const a = args as Record<string, unknown>;

  const patchText = stringArgument(a, "patch_text", "patchText", "patch");
  if (toolName === "apply_patch" && patchText) {
    return parsePatchTextDiffs(patchText, workspaceRoot);
  }

  if (
    (toolName === "write_file" || toolName === "create_file") &&
    typeof a.path === "string" &&
    typeof a.content === "string"
  ) {
    const lines = a.content.split("\n").map((l) => `+${l}`);
    return [
      {
        path: displayWorkspacePath(a.path, workspaceRoot),
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
function parsePatchTextDiffs(
  patchText: string,
  workspaceRoot: string,
): FileEditDiff[] {
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
      currentPath = displayWorkspacePath(
        (sectionMatch[2] ?? "").trim(),
        workspaceRoot,
      );
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

function stripHtmlSpans(value: string): string {
  return value.replace(/<\/?span\b[^>]*>/giu, "");
}

function commandOutputPreviewLimit(columns = process.stdout.columns ?? 80): number {
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
