import {
  openEventStream,
} from "../api/sse.ts";
import { renderError } from "./render.ts";
import { writeOutputLine } from "./terminal.ts";
import { ToolActivityRenderer } from "./tool-activity.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

const toolActivityRenderer = new ToolActivityRenderer(writeOutputLine);

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
    toolActivityRenderer.renderToolCall(payload);
    return;
  }

  if (event.event === "tool_result" && payload) {
    toolActivityRenderer.renderToolResult(payload);
  }
}

export function consumeToolActivity(): boolean {
  return toolActivityRenderer.consumeActivity();
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
