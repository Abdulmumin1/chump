import {
  renderMarkdownBlock,
  renderMuted,
  renderUserMessage,
} from "./render.ts";
import { ReasoningRenderer } from "./reasoning.ts";
import { writeOutput, writeOutputLine, withDraftPaused } from "./terminal.ts";
import { compactJson, ToolActivityRenderer } from "./tool-activity.ts";
import type {
  ChumpHealth,
  ChumpStatus,
  ManagedServerMetadata,
} from "../core/types.ts";

const MAX_REPLAY_MESSAGES = 80;

export function renderStoredMessages(
  messages: Array<{ role: string; content: unknown }>,
): void {
  // Pause the input draft during message rendering to prevent
  // input box borders/controls from mixing with the content
  withDraftPaused(() => {
    if (messages.length === 0) {
      writeOutputLine("(no stored messages)");
      return;
    }

    for (const [index, message] of messages.entries()) {
      writeOutputLine(`[${index + 1}] ${message.role}`);
      writeOutputLine(formatStoredContent(message.content));
    }
  });
}

export function renderSessionTranscript(
  messages: Array<{ role: string; content: unknown }>,
): void {
  // Pause the input draft during transcript rendering to prevent
  // input box borders/controls from mixing with the session content
  withDraftPaused(() => {
    renderApproximateTranscript(recentMessages(messages));
  });
}

function renderApproximateTranscript(
  messages: Array<{ role: string; content: unknown }>,
): void {
  if (messages.length === 0) {
    writeOutputLine(renderMuted("(no messages in session)"));
    return;
  }

  const toolRenderer = new ToolActivityRenderer(writeOutputLine);
  const reasoningRenderer = new ReasoningRenderer();
  let renderedMessages = 0;

  for (const message of messages) {
    if (message.role === "user" && renderUserContent(message.content)) {
      renderedMessages += 1;
      continue;
    }

    if (message.role === "assistant" || message.role === "tool") {
      reasoningRenderer.flush();
      if (message.role === "assistant" && toolRenderer.consumeActivity()) {
        writeOutputLine();
      }
      renderedMessages += renderAssistantContent(message.content, toolRenderer, reasoningRenderer);
      continue;
    }

    const text = extractTextContent(message.content).trim();
    if (text.length > 0) {
      reasoningRenderer.flush();
      writeOutputLine(renderMuted(`[${message.role}] ${text}`));
      renderedMessages += 1;
    }
  }

  reasoningRenderer.flush();

  if (renderedMessages === 0) {
    writeOutputLine(renderMuted("(no renderable messages in session)"));
  }
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
  // Pause the input draft during session list rendering to prevent
  // input box borders/controls from mixing with the content
  withDraftPaused(() => {
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
  });
}

export function renderServerStatus(
  health: ChumpHealth,
  status: ChumpStatus,
  metadata: ManagedServerMetadata | null,
): void {
  // Pause the input draft during server status rendering to prevent
  // input box borders/controls from mixing with the content
  withDraftPaused(() => {
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
  });
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
  reasoningRenderer: ReasoningRenderer,
): number {
  if (typeof content === "string") {
    return renderAssistantText(content);
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  let renderedParts = 0;
  for (const part of content) {
    const reasoning = readReasoningPart(part);
    if (reasoning !== null) {
      reasoningRenderer.render({ text: reasoning, kind: "delta", provider: "" });
      renderedParts += 1;
      continue;
    }

    const text = readTextPart(part);
    if (text !== null) {
      reasoningRenderer.flush();
      if (toolRenderer.consumeActivity()) {
        writeOutputLine();
      }
      renderedParts += renderAssistantText(text);
      continue;
    }

    const toolCall = readToolCallPart(part);
    if (toolCall) {
      reasoningRenderer.flush();
      toolRenderer.renderToolCall({ name: toolCall.name, args: toolCall.arguments });
      renderedParts += 1;
      continue;
    }

    const toolResult = readToolResultPart(part);
    if (toolResult) {
      reasoningRenderer.flush();
      toolRenderer.renderToolResult({
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

function readReasoningPart(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return null;
  }
  const value = part as Record<string, unknown>;
  if (value.type === "reasoning" && typeof value.text === "string") {
    return value.text;
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
