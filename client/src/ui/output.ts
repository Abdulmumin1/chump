import { renderMuted } from "./render.ts";
import { writeOutputLine } from "./terminal.ts";
import type { ManagedServerMetadata } from "../core/types.ts";

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

export function renderSessions(
  sessions: Array<{
    id: string;
    active: boolean;
    message_count: number;
    event_count: number;
    last_user_goal: string | null;
  }>,
): void {
  if (sessions.length === 0) {
    writeOutputLine("(no stored sessions)");
    return;
  }

  for (const session of sessions) {
    const active = session.active ? "active" : "stored";
    const goal = session.last_user_goal ? ` ${session.last_user_goal}` : "";
    writeOutputLine(
      `${session.id} ${renderMuted(active)} messages=${session.message_count} events=${session.event_count}${goal}`,
    );
  }
}

export function renderServerStatus(
  health: unknown,
  status: unknown,
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
