import {
  renderMuted,
} from "./render.ts";
import { writeOutputLine, withDraftPaused } from "./terminal.ts";
import {
  renderStoredMessageFallback,
  TranscriptRenderer,
  transcriptEventsFromStoredMessages,
} from "./transcript.ts";
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
      writeOutputLine(renderStoredMessageFallback(message.content));
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

  const renderer = new TranscriptRenderer({ liveReasoning: false });
  const events = transcriptEventsFromStoredMessages(messages);
  for (const event of events) {
    if (event.type === "assistant_text" && renderer.consumeToolActivity()) {
      writeOutputLine();
    }
    renderer.render(event);
  }
  renderer.finish();

  if (events.length === 0) {
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
