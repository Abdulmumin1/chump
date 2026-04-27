import {
  openEventStream,
} from "../api/sse.ts";
import {
  renderCommand,
  renderCommandOutput,
  renderError,
  renderToolDone,
  renderToolResult,
} from "./render.ts";
import { writeOutputLine } from "./terminal.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

const pendingTools: Array<{
  name: string;
  args: string;
}> = [];

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
      return;
    }
    if (toolName === "read_file") {
      writeOutputLine(`\n${renderToolDone(toolName, renderedArgs)}`);
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
      return;
    }

    const pending = takePendingTool(toolName);
    if (ok === "ok" && toolName === "read_file") {
      return;
    }

    if (ok === "ok" && pending) {
      writeOutputLine(`\n${renderToolDone(toolName, pending.args)}`);
      return;
    }

    writeOutputLine(`\n${renderToolResult(ok, toolName, preview)}`);
  }
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
