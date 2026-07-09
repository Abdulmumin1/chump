import {
  createMarkdownStream,
  renderError,
  renderMarkdownBlock,
  renderMuted,
  renderUserMessage,
} from "./render.ts";
import { LiveReasoningStream, ReasoningRenderer } from "./reasoning.ts";
import { writeOutput, writeOutputLine } from "./terminal.ts";
import { compactJson, ToolActivityRenderer } from "./tool-activity.ts";
import type { StoredMessage, SseEvent, TranscriptEvent } from "../core/types.ts";

export type TranscriptRendererHooks = {
  onToolActivity?: ((preview: string) => void) | null;
  onToolCallStream?: ((preview: string | null) => void) | null;
  onToolResult?: (() => void) | null;
  onReasoningActivity?: ((payload: Record<string, unknown>) => void) | null;
  onSteeringAccepted?: ((content: string) => void) | null;
  onAssistantText?: ((content: string) => boolean) | null;
  onAgentStatus?: ((payload: Record<string, unknown>) => void) | null;
  onSteeringQueue?: ((payload: Record<string, unknown>) => void) | null;
  onTurnStatus?: ((payload: Record<string, unknown>) => void) | null;
  onCompactionStatus?: ((payload: Record<string, unknown>) => void) | null;
};

export class TranscriptRenderer {
  private readonly toolActivityRenderer = new ToolActivityRenderer(writeOutputLine);
  private readonly reasoningRenderer: LiveReasoningStream | ReasoningRenderer;
  private readonly hooks: TranscriptRendererHooks;
  private assistantStream: ReturnType<typeof createMarkdownStream> | null = null;

  constructor(options: {
    hooks?: TranscriptRendererHooks;
    liveReasoning?: boolean;
    onReasoningPreview?: ((preview: string | null) => void) | null;
  } = {}) {
    this.hooks = options.hooks ?? {};
    this.reasoningRenderer = options.liveReasoning === false
      ? new ReasoningRenderer()
      : new LiveReasoningStream({ onPreview: options.onReasoningPreview ?? null });
  }

  render(event: TranscriptEvent): void {
    if (event.type !== "assistant_text") {
      this.flushAssistantStream();
    }

    switch (event.type) {
      case "assistant_text":
        this.renderAssistantText(event.content);
        return;
      case "user_message":
        this.renderUserMessage(event.payload);
        return;
      case "tool_call":
        this.finishReasoning();
        this.hooks.onToolActivity?.(
          this.toolActivityRenderer.renderToolCall(event.payload),
        );
        return;
      case "tool_call_stream":
        this.finishReasoning();
        this.hooks.onToolCallStream?.(
          this.toolActivityRenderer.renderToolCallStream(event.payload),
        );
        return;
      case "tool_result":
        if (this.toolActivityRenderer.renderToolResult(event.payload)) {
          this.hooks.onToolResult?.();
        }
        return;
      case "reasoning":
        this.hooks.onReasoningActivity?.(event.payload);
        this.reasoningRenderer.render(event.payload);
        return;
      case "agent_status":
        this.hooks.onAgentStatus?.(event.payload);
        return;
      case "steering_queue":
        this.hooks.onSteeringQueue?.(event.payload);
        return;
      case "turn_status":
        this.hooks.onTurnStatus?.(event.payload);
        return;
      case "compaction_status":
        this.hooks.onCompactionStatus?.(event.payload);
        return;
      case "stream_end":
        this.finishReasoning();
        this.flushAssistantStream();
        if (event.fallback) {
          writeOutput(`${renderMuted(event.fallback)}\n`);
        }
        return;
      case "stream_error":
        this.finishReasoning();
        this.flushAssistantStream();
        writeOutput(
          event.aborted
            ? `${renderMuted("(aborted)")}\n`
            : `\n${renderError(`[chat] ${event.message}`)}\n`,
        );
        return;
    }
  }

  consumeToolActivity(): boolean {
    return this.toolActivityRenderer.consumeActivity();
  }

  beginAssistantText(): void {
    this.finishReasoning();
  }

  finish(): void {
    this.flushAssistantStream();
    this.finishReasoning();
  }

  private renderAssistantText(content: string): void {
    if (!content) {
      return;
    }
    this.beginAssistantText();
    if (this.hooks.onAssistantText?.(content)) {
      return;
    }
    this.assistantStream ??= createMarkdownStream();
    this.assistantStream.write(content);
  }

  private renderUserMessage(payload: Record<string, unknown>): void {
    if (payload.steered === true) {
      const content = userMessageDisplayFromPayload(payload);
      if (content.trim()) {
        this.hooks.onSteeringAccepted?.(content);
      }
    }
    const content = userMessageDisplayFromPayload(payload);
    if (content.trim()) {
      writeOutputLine(renderUserMessage(content));
    }
  }

  private flushAssistantStream(): void {
    this.assistantStream?.end();
    this.assistantStream = null;
  }

  private finishReasoning(): void {
    this.reasoningRenderer.finish();
  }
}

export function transcriptEventFromSse(event: SseEvent): TranscriptEvent | null {
  const payload = parseEventPayload(event.data);

  if (event.event === "assistant_text" && payload) {
    const content = typeof payload.content === "string" ? payload.content : "";
    return content ? { type: "assistant_text", content } : null;
  }

  if (event.event === "tool_execution.finished" && payload) {
    return { type: "tool_result", payload };
  }

  if (
    (event.event === "tool_call.started" ||
      event.event === "tool_call.delta") &&
    payload
  ) {
    return {
      type: "tool_call_stream",
      payload: { ...payload, lifecycle_type: event.event },
    };
  }

  if (
    event.event === "tool_call" ||
    event.event === "tool_result" ||
    event.event === "reasoning" ||
    event.event === "agent_status" ||
    event.event === "steering_queue" ||
    event.event === "turn_status" ||
    event.event === "compaction_status" ||
    event.event === "user_message"
  ) {
    return payload ? { type: event.event, payload } : null;
  }

  return null;
}

export function transcriptEventsFromStoredMessages(messages: StoredMessage[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = userMessageDisplayFromContent(message.content).trim();
      if (content) {
        events.push({ type: "user_message", payload: { content } });
      }
      continue;
    }

    if (message.role === "assistant" || message.role === "tool") {
      events.push(...transcriptEventsFromAssistantContent(message.content));
      continue;
    }

    const text = extractTextContent(message.content).trim();
    if (text) {
      events.push({ type: "assistant_text", content: `[${message.role}] ${text}` });
    }
  }
  return events;
}

export function renderStoredMessageFallback(content: unknown): string {
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

export function userMessageDisplayFromPayload(payload: Record<string, unknown>): string {
  const display = typeof payload.display_content === "string" ? payload.display_content : "";
  if (display.trim()) {
    return display;
  }

  return typeof payload.content === "string" ? payload.content : "";
}

function transcriptEventsFromAssistantContent(content: unknown): TranscriptEvent[] {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? [{ type: "assistant_text", content: trimmed }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const events: TranscriptEvent[] = [];
  for (const part of content) {
    const reasoning = readReasoningPart(part);
    if (reasoning !== null) {
      events.push({ type: "reasoning", payload: { text: reasoning, kind: "delta", provider: "" } });
      continue;
    }

    const text = readTextPart(part);
    if (text !== null) {
      events.push({ type: "assistant_text", content: text });
      continue;
    }

    const toolCall = readToolCallPart(part);
    if (toolCall) {
      const args = normalizeToolCallArgs(toolCall.name, toolCall.arguments);
      events.push({
        type: "tool_call",
        payload: {
          name: toolCall.name,
          args,
          call_id: toolCall.callId,
          step: toolCall.step,
          index: toolCall.index,
        },
      });
      continue;
    }

    const toolResult = readToolResultPart(part);
    if (toolResult) {
      const preview = isSkillTool(toolResult.toolName)
        ? loadedSkillPreview(toolResult.result)
        : toolResult.result;
      events.push({
        type: "tool_result",
        payload: {
          name: toolResult.toolName,
          ok: !toolResult.isError,
          status: toolResult.isError ? "error" : "ok",
          preview,
          call_id: toolResult.callId,
          step: toolResult.step,
          index: toolResult.index,
        },
      });
    }
  }
  return events;
}

function normalizeToolCallArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!isSkillTool(toolName)) {
    return args;
  }

  const rawName = typeof args.name === "string" ? args.name : "";
  const normalizedName = skillNameFromContent(rawName) || rawName;
  return normalizedName === rawName ? args : { ...args, name: normalizedName };
}

function isSkillTool(toolName: string): boolean {
  return toolName === "skill" || toolName === "load_skill";
}

function skillNameFromContent(value: string): string {
  const match = /<skill_content\s+name=["']([^"']+)["']/.exec(value);
  return match?.[1]?.trim() ?? "";
}

function loadedSkillPreview(value: string): string {
  const name = skillNameFromContent(value);
  return name ? `Loaded skill: ${name}` : "Loaded skill.";
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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => readTextPart(part) ?? "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function userMessageDisplayFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  let rendered = "";
  for (const part of content) {
    const text = readTextPart(part);
    if (text !== null) {
      rendered = appendDisplayText(rendered, text);
      continue;
    }

    const imageLabel = imagePartDisplayLabel(part);
    if (imageLabel) {
      rendered = appendDisplayImageMarker(rendered, imageLabel);
    }
  }

  return rendered;
}

function attachmentDisplayLabel(attachment: unknown): string {
  if (!attachment || typeof attachment !== "object") {
    return "";
  }

  const value = attachment as Record<string, unknown>;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (label) {
    return label;
  }

  const filename = typeof value.filename === "string" ? value.filename.trim() : "";
  if (filename) {
    return `[Image: ${filename}]`;
  }

  const mime = typeof value.mime === "string"
    ? value.mime.trim()
    : typeof value.media_type === "string"
      ? value.media_type.trim()
      : "";
  return mime ? `[Image · ${mime}]` : "[Image]";
}

function imagePartDisplayLabel(part: unknown): string {
  if (!part || typeof part !== "object") {
    return "";
  }

  const value = part as Record<string, unknown>;
  if (value.type !== "image") {
    return "";
  }

  return attachmentDisplayLabel(value);
}

function appendDisplayText(rendered: string, text: string): string {
  if (!text) {
    return rendered;
  }
  if (rendered && rendered.endsWith("]") && !/^\s/u.test(text)) {
    return `${rendered} ${text}`;
  }
  return `${rendered}${text}`;
}

function appendDisplayImageMarker(rendered: string, label: string): string {
  if (!label) {
    return rendered;
  }
  if (!rendered) {
    return label;
  }
  return /[\s\n]$/u.test(rendered) ? `${rendered}${label}` : `${rendered} ${label}`;
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
  callId?: string;
  step?: number;
  index?: number;
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
    callId: typeof call.id === "string" ? call.id : undefined,
    step: typeof call.step === "number" ? call.step : undefined,
    index: typeof call.index === "number" ? call.index : undefined,
  };
}

function readToolResultPart(part: unknown): {
  toolName: string;
  result: string;
  isError: boolean;
  callId?: string;
  step?: number;
  index?: number;
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
    callId:
      typeof result.tool_call_id === "string"
        ? result.tool_call_id
        : undefined,
    step: typeof result.step === "number" ? result.step : undefined,
    index: typeof result.index === "number" ? result.index : undefined,
  };
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
