import {
  openEventStream,
} from "../api/sse.ts";
import {
  renderCommand,
  renderCommandOutput,
  renderError,
  renderFileEditDiff,
  renderToolDone,
  renderToolResult,
} from "./render.ts";
import { writeOutputLine } from "./terminal.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

const pendingTools: Array<{
  name: string;
  args: string;
}> = [];

let activitySinceReset = false;

export async function startEventStream(config: ChumpConfig): Promise<(() => void) | null> {
  try {
    return await openEventStream(config, {
      onEvent: (event) => logEvent(event),
      onError: (error) => console.error(renderError(`[events] ${error.message}`)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(renderError(`[events] ${message}`));
    return null;
  }
}

function logEvent(event: SseEvent): void {
  const payload = parseEventPayload(event.data);

  if (event.event === "tool_call" && payload) {
    const toolName = readToolName(payload);
    const renderedArgs = formatToolArgs(toolName, payload.args ?? payload.payload);
    if (toolName === "bash") {
      writeOutputLine(`\n${renderCommand(renderedArgs)}`);
      activitySinceReset = true;
      return;
    }
    if (toolName === "read_file") {
      writeOutputLine(`\n${renderToolDone(toolName, renderedArgs)}`);
      activitySinceReset = true;
      pendingTools.push({ name: toolName, args: renderedArgs });
      return;
    }
    pendingTools.push({ name: toolName, args: renderedArgs });
    return;
  }

  if (event.event === "tool_result" && payload) {
    const toolName = readToolName(payload);
    const ok =
      typeof payload.status === "string"
        ? payload.status
        : payload.ok === true ? "ok" : "error";
    const preview =
      typeof payload.preview === "string" ? payload.preview : compactJson(payload);
    if (toolName === "bash") {
      writeOutputLine(renderCommandOutput(ok, truncatePreview(preview, 500)));
      activitySinceReset = true;
      return;
    }

    const diff = readFileEditDiff(payload);
    if (ok === "ok" && diff && (toolName === "write_file" || toolName === "replace_in_file")) {
      takePendingTool(toolName);
      writeOutputLine(`\n${renderFileEditDiff(diff)}`);
      activitySinceReset = true;
      return;
    }

    const pending = takePendingTool(toolName);
    if (ok === "ok" && toolName === "read_file") {
      return;
    }

    if (ok === "ok" && pending) {
      writeOutputLine(`\n${renderToolDone(toolName, pending.args)}`);
      activitySinceReset = true;
      return;
    }

    writeOutputLine(`\n${renderToolResult(ok, toolName, preview)}`);
    activitySinceReset = true;
  }
}

export function consumeToolActivity(): boolean {
  const hadActivity = activitySinceReset;
  activitySinceReset = false;
  return hadActivity;
}

function takePendingTool(name: string): {
  name: string;
  args: string;
} | null {
  const index = pendingTools.findIndex((tool) => tool.name === name);
  if (index === -1) {
    return null;
  }
  const [tool] = pendingTools.splice(index, 1);
  return tool ?? null;
}

function parseEventPayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function compactJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (!encoded) {
    return "";
  }
  if (encoded.length <= 120) {
    return encoded;
  }
  return `${encoded.slice(0, 117)}...`;
}

function readToolName(payload: Record<string, unknown>): string {
  if (typeof payload.name === "string") {
    return payload.name;
  }
  if (typeof payload.tool === "string") {
    return payload.tool;
  }
  return "tool";
}

function readFileEditDiff(payload: Record<string, unknown>): {
  path: string;
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
} | null {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const diff = (metadata as Record<string, unknown>).diff;
  if (!diff || typeof diff !== "object") {
    return null;
  }
  const value = diff as Record<string, unknown>;
  if (
    typeof value.path !== "string" ||
    typeof value.added !== "number" ||
    typeof value.removed !== "number"
  ) {
    return null;
  }
  const changes = Array.isArray(value.changes)
    ? value.changes.map(readFileEditChange).filter((change) => change !== null)
    : undefined;
  const lines = Array.isArray(value.lines)
    ? value.lines.filter((line): line is string => typeof line === "string")
    : undefined;
  return {
    path: value.path,
    added: value.added,
    removed: value.removed,
    changes,
    lines,
    truncated: value.truncated === true,
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

function formatToolArgs(toolName: string, value: unknown): string {
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
    ].filter(Boolean).join(" ");
    return [path, range].filter(Boolean).join(" ");
  }

  if (toolName === "bash") {
    return typeof args.command === "string" ? args.command : "";
  }

  return compactJson(value);
}

function truncatePreview(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 16)} ...[truncated]`;
}
