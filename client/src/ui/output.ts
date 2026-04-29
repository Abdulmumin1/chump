import {
  createMarkdownStream,
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

const MAX_REPLAY_USER_TURNS = 20;
const MAX_REPLAY_MESSAGES = 80;

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
  if (hasExactTranscript(events)) {
    const replay = recentEventWindow(events);
    renderEventTimeline(replay.events, replay.skipped);
    return;
  }

  renderApproximateTranscript(recentMessages(messages), events);
}

function renderApproximateTranscript(
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
      reasoningRenderer.flush();
      renderedMessages += renderAssistantContent(
        message.content,
        toolRenderer,
        replayEvents,
      );
      continue;
    }

    const text = extractTextContent(message.content).trim();
    if (text.length > 0) {
      reasoningRenderer.flush();
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

function renderEventTimeline(events: StoredEvent[], skippedEvents = 0): void {
  const toolRenderer = new ToolActivityRenderer(writeOutputLine);
  const reasoningRenderer = new ReasoningRenderer();
  let markdownStream: ReturnType<typeof createMarkdownStream> | null = null;
  let renderedItems = 0;

  if (skippedEvents > 0) {
    writeOutputLine(renderMuted(`(showing recent transcript; skipped ${skippedEvents} older events)`));
  }

  const flushAssistantText = (): void => {
    markdownStream?.end();
    markdownStream = null;
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message": {
        flushAssistantText();
        reasoningRenderer.flush();
        const text = typeof event.data.content === "string" ? event.data.content.trim() : "";
        if (!text) {
          break;
        }
        writeOutput(`${renderUserMessage(text)}\n`);
        renderedItems += 1;
        break;
      }
      case "reasoning":
        flushAssistantText();
        reasoningRenderer.render(event.data);
        renderedItems += 1;
        break;
      case "assistant_text": {
        reasoningRenderer.flush();
        const text = typeof event.data.content === "string" ? event.data.content : "";
        if (!text) {
          break;
        }
        markdownStream ??= createMarkdownStream();
        markdownStream.write(text);
        renderedItems += 1;
        break;
      }
      case "tool_call":
        flushAssistantText();
        reasoningRenderer.flush();
        toolRenderer.renderToolCall(event.data);
        renderedItems += 1;
        break;
      case "tool_result":
        flushAssistantText();
        reasoningRenderer.flush();
        toolRenderer.renderToolResult(event.data);
        renderedItems += 1;
        break;
      default:
        break;
    }
  }

  flushAssistantText();
  reasoningRenderer.flush();

  if (renderedItems === 0) {
    writeOutputLine(renderMuted("(no renderable messages in session)"));
  }
}

function recentEventWindow(events: StoredEvent[]): {
  events: StoredEvent[];
  skipped: number;
} {
  const userMessageIndexes = events
    .map((event, index) => event.type === "user_message" ? index : -1)
    .filter((index) => index >= 0);

  if (userMessageIndexes.length <= MAX_REPLAY_USER_TURNS) {
    return { events, skipped: 0 };
  }

  const start = userMessageIndexes[userMessageIndexes.length - MAX_REPLAY_USER_TURNS] ?? 0;
  return {
    events: events.slice(start),
    skipped: start,
  };
}

function recentMessages(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: string; content: unknown }> {
  if (messages.length <= MAX_REPLAY_MESSAGES) {
    return messages;
  }

  writeOutputLine(renderMuted(`(showing recent transcript; skipped ${messages.length - MAX_REPLAY_MESSAGES} older messages)`));
  return messages.slice(-MAX_REPLAY_MESSAGES);
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

  writeOutputLine(renderMuted(`${"Updated".padEnd(18, " ")}${"Created".padEnd(18, " ")}Conversation`));
  for (const session of sessions) {
    const title = sessionTitle(session);
    const updated = session.updated_at ? formatSessionTime(session.updated_at) : "-";
    const created = session.created_at ? formatSessionTime(session.created_at) : "-";
    writeOutputLine(`${renderMuted(updated.padEnd(18, " "))}${renderMuted(created.padEnd(18, " "))}${title}`);
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

function hasExactTranscript(events: StoredEvent[]): boolean {
  return events.some((event) => event.type === "user_message" || event.type === "assistant_text");
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
