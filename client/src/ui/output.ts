import {
  renderMarkdownBlock,
  renderMuted,
  renderUserMessage,
} from "./render.ts";
import { ReasoningRenderer } from "./reasoning.ts";
import { writeOutput, writeOutputLine } from "./terminal.ts";
import { compactJson, ToolActivityRenderer } from "./tool-activity.ts";
import type {
  ChumpHealth,
  ChumpStatus,
  ManagedServerMetadata,
  StoredEvent,
} from "../core/types.ts";

export function renderStoredMessages(
  messages: Array<{ role: string; content: unknown }>,
): void {
  if (messages.length === 0) {
    writeOutputLine("(no stored messages)");
    return;
  }

  for (const [index, message] of messages.entries()) {
    writeOutputLine(`[${index + 1}] ${message.role}`);
    writeOutputLine(formatStoredContent(message.content));
  }
}

export function renderSessionTranscript(
  messages: Array<{ role: string; content: unknown }>,
  events: StoredEvent[] = [],
): void {
  if (messages.length === 0) {
    writeOutputLine(renderMuted("(no messages in session)"));
    return;
  }

  const toolRenderer = new ToolActivityRenderer(writeOutputLine);
  const reasoningRenderer = new ReasoningRenderer();
  const replayEvents = new TranscriptEventCursor(events);
  let renderedMessages = 0;

  for (const message of messages) {
    if (message.role === "user" && renderUserContent(message.content)) {
      renderedMessages += 1;
      continue;
    }

    if (message.role === "assistant" || message.role === "tool") {
      replayEvents.renderLeadingReasoning(reasoningRenderer);
      renderedMessages += renderAssistantContent(
        message.content,
        toolRenderer,
        replayEvents,
      );
      continue;
    }

    const text = extractTextContent(message.content).trim();
    if (text.length > 0) {
      writeOutputLine(renderMuted(`[${message.role}] ${text}`));
      renderedMessages += 1;
    }
  }

  if (renderedMessages === 0) {
    writeOutputLine(renderMuted("(no renderable messages in session)"));
  }

  replayEvents.renderLeadingReasoning(reasoningRenderer);
  reasoningRenderer.flush();
}

export function renderSessions(
  sessions: Array<{
    id: string;
    active: boolean;
    message_count: number;
    event_count: number;
    title: string | null;
    created_at: number | null;
    updated_at: number | null;
    last_user_goal: string | null;
  }>,
): void {
  if (sessions.length === 0) {
    writeOutputLine("(no stored sessions)");
    return;
  }

  for (const session of sessions) {
    const title = sessionTitle(session);
    const updated = session.updated_at ? `updated ${formatSessionTime(session.updated_at)}` : null;
    const created = session.created_at ? `created ${formatSessionTime(session.created_at)}` : null;
    const details = [
      updated ? renderMuted(updated) : null,
      created ? renderMuted(created) : null,
    ].filter(Boolean).join(" · ");
    writeOutputLine(
      details ? `${title}\n${details}` : title,
    );
  }
}

export function renderServerStatus(
  health: ChumpHealth,
  status: ChumpStatus,
  metadata: ManagedServerMetadata | null,
): void {
  if (!metadata) {
    writeOutputLine(JSON.stringify({
      health,
      agent: status,
    }, null, 2));
    return;
  }

  writeOutputLine(JSON.stringify({
    server: metadata,
    health,
    agent: status,
  }, null, 2));
}

function renderUserContent(content: unknown): boolean {
  const text = extractTextContent(content).trim();
  if (text.length === 0) {
    return false;
  }
  writeOutput(`${renderUserMessage(text)}\n`);
  return true;
}

function renderAssistantContent(
  content: unknown,
  toolRenderer: ToolActivityRenderer,
  replayEvents: TranscriptEventCursor,
): number {
  if (typeof content === "string") {
    return renderAssistantText(content);
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  let renderedParts = 0;
  for (const part of content) {
    const text = readTextPart(part);
    if (text !== null) {
      renderedParts += renderAssistantText(text);
      continue;
    }

    const toolCall = readToolCallPart(part);
    if (toolCall) {
      toolRenderer.renderToolCall(replayEvents.takeToolCall(toolCall.name) ?? {
        name: toolCall.name,
        args: toolCall.arguments,
      });
      renderedParts += 1;
      continue;
    }

    const toolResult = readToolResultPart(part);
    if (toolResult) {
      toolRenderer.renderToolResult(replayEvents.takeToolResult(toolResult.toolName) ?? {
        name: toolResult.toolName,
        ok: !toolResult.isError,
        status: toolResult.isError ? "error" : "ok",
        preview: toolResult.result,
      });
      renderedParts += 1;
    }
  }

  return renderedParts;
}

class TranscriptEventCursor {
  private readonly events: StoredEvent[] = [];

  constructor(events: StoredEvent[]) {
    for (const event of events) {
      if (
        event.type !== "tool_call" &&
        event.type !== "tool_result" &&
        event.type !== "reasoning"
      ) {
        continue;
      }
      this.events.push(event);
    }
  }

  takeToolCall(toolName: string): Record<string, unknown> | null {
    return this.takeNextEvent("tool_call", toolName);
  }

  takeToolResult(toolName: string): Record<string, unknown> | null {
    return this.takeNextEvent("tool_result", toolName);
  }

  renderLeadingReasoning(reasoningRenderer: ReasoningRenderer): void {
    while (this.events[0]?.type === "reasoning") {
      const event = this.events.shift();
      if (!event) {
        break;
      }
      reasoningRenderer.render(event.data);
    }
  }

  private takeNextEvent(type: "tool_call" | "tool_result", toolName: string): Record<string, unknown> | null {
    for (let index = 0; index < this.events.length; index += 1) {
      const event = this.events[index];
      if (!event || event.type !== type) {
        continue;
      }
      if (readEventToolName(event.data) !== toolName) {
        continue;
      }
      this.events.splice(index, 1);
      return event.data;
    }
    return null;
  }
}

function readEventToolName(data: Record<string, unknown>): string | null {
  if (typeof data.name === "string") {
    return data.name;
  }
  if (typeof data.tool === "string") {
    return data.tool;
  }
  if (typeof data.tool_name === "string") {
    return data.tool_name;
  }
  return null;
}

function renderAssistantText(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  writeOutput(`${renderMarkdownBlock(trimmed)}\n`);
  return 1;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => extractTextPart(part))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractTextPart(part: unknown): string {
  return readTextPart(part) ?? "";
}

function readTextPart(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return typeof part === "string" ? part : null;
  }

  const value = part as Record<string, unknown>;
  if (value.type === "text" && typeof value.text === "string") {
    return value.text;
  }

  return null;
}

function readToolCallPart(part: unknown): {
  name: string;
  arguments: Record<string, unknown>;
} | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const value = part as Record<string, unknown>;
  if (value.type !== "tool_call" || !value.tool_call || typeof value.tool_call !== "object") {
    return null;
  }
  const call = value.tool_call as Record<string, unknown>;
  if (typeof call.name !== "string") {
    return null;
  }
  return {
    name: call.name,
    arguments: (
      call.arguments && typeof call.arguments === "object"
        ? call.arguments
        : {}
    ) as Record<string, unknown>,
  };
}

function readToolResultPart(part: unknown): {
  toolName: string;
  result: string;
  isError: boolean;
} | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const value = part as Record<string, unknown>;
  if (
    value.type !== "tool_result" ||
    !value.tool_result ||
    typeof value.tool_result !== "object"
  ) {
    return null;
  }
  const result = value.tool_result as Record<string, unknown>;
  if (typeof result.tool_name !== "string") {
    return null;
  }
  return {
    toolName: result.tool_name,
    result: typeof result.result === "string" ? result.result : compactJson(result.result),
    isError: result.is_error === true,
  };
}

function formatStoredContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const formatted = content
      .map((part) => formatStoredPart(part))
      .filter(Boolean)
      .join("\n");
    return formatted || JSON.stringify(content, null, 2);
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }

  return String(content);
}

function formatStoredPart(part: unknown): string {
  if (!part || typeof part !== "object") {
    return String(part);
  }

  const value = part as Record<string, unknown>;
  if (value.type === "text" && typeof value.text === "string") {
    return value.text;
  }
  if (value.type === "tool_call" && value.tool_call && typeof value.tool_call === "object") {
    const call = value.tool_call as Record<string, unknown>;
    return `[tool_call] ${String(call.name ?? "unknown")} ${compactJson(call.arguments)}`;
  }
  if (value.type === "tool_result" && value.tool_result && typeof value.tool_result === "object") {
    const result = value.tool_result as Record<string, unknown>;
    return `[tool_result] ${String(result.tool_name ?? "unknown")} ${compactJson(result.result)}`;
  }

  return JSON.stringify(value, null, 2);
}

function formatSessionTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function sessionTitle(session: {
  title: string | null;
  last_user_goal: string | null;
}): string {
  const title = session.title?.trim() || session.last_user_goal?.trim();
  return clipSessionTitle(title || "Untitled session");
}

function clipSessionTitle(value: string): string {
  if (value.length <= 72) {
    return value;
  }
  return `${value.slice(0, 69).trimEnd()}...`;
}
