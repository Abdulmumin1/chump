#!/usr/bin/env node

import readline from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  clearMessages,
  getHealth,
  getMessages,
  getSessions,
  getState,
  getStatus,
  openEventStream,
  streamChat,
} from "./api.ts";
import { parseSlashCommand, printHelp, switchAgent } from "./commands.ts";
import {
  createSessionId,
  loadConfig,
  renderBanner,
  resolveWorkspaceRoot,
} from "./config.ts";
import {
  ensureServerTarget,
  parseCliArgs,
  printCliUsage,
  startServerCommand,
  stopManagedServer,
} from "./runtime.ts";
import type { ChumpConfig, ManagedServerMetadata, SseEvent } from "./types.ts";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());

  if (options.mode === "help") {
    printCliUsage();
    return;
  }

  if (options.mode === "stop") {
    console.log(await stopManagedServer(workspaceRoot));
    return;
  }

  if (options.mode === "server") {
    const result = await startServerCommand(workspaceRoot);
    if (!result.started) {
      console.log(`server already running at ${result.metadata.url}`);
    }
    return;
  }

  const target = await ensureServerTarget(workspaceRoot, options);
  let config = loadConfig({
    serverUrl: target.serverUrl,
    serverSource: target.serverSource,
  });

  if (options.mode === "status") {
    const [health, status] = await Promise.all([
      getHealth(config),
      getStatus(config),
    ]);
    renderServerStatus(health, status, target.metadata);
    return;
  }

  const rl = readline.createInterface({ input, output });
  let closeEventStream: (() => void) | null = null;

  if (target.note) {
    console.log(`[server] ${target.note}`);
  }
  console.log(renderBanner(config));
  closeEventStream = await startEventStream(config);

  try {
    while (true) {
      let line = "";
      try {
        line = (await rl.question("> ")).trim();
      } catch {
        break;
      }

      if (!line) {
        continue;
      }

      const parsed = parseSlashCommand(line);
      if (parsed) {
        switch (parsed.command) {
          case "help":
            printHelp();
            break;
          case "status": {
            const [health, status] = await Promise.all([
              getHealth(config),
              getStatus(config),
            ]);
            renderServerStatus(health, status, target.metadata);
            break;
          }
          case "state": {
            const state = await getState(config);
            console.log(JSON.stringify(state, null, 2));
            break;
          }
          case "messages": {
            const response = await getMessages(config);
            renderStoredMessages(response.messages);
            break;
          }
          case "sessions": {
            const response = await getSessions(config);
            renderSessions(response.sessions);
            break;
          }
          case "clear": {
            const result = await clearMessages(config);
            console.log(JSON.stringify(result, null, 2));
            break;
          }
          case "session": {
            const mode = parsed.args[0];
            if (!mode) {
              console.log(`current session: ${config.agentId}`);
              break;
            }

            closeEventStream?.();
            closeEventStream = null;

            if (mode === "new") {
              config = switchAgent(config, createSessionId(config.workspaceRoot));
              closeEventStream = await startEventStream(config);
              console.log(`started new session ${config.agentId}`);
              break;
            }

            config = switchAgent(config, mode);
            closeEventStream = await startEventStream(config);
            console.log(`switched session to ${config.agentId}`);
            break;
          }
          case "agent": {
            const nextAgentId = parsed.args[0];
            if (!nextAgentId) {
              console.log("usage: /agent <id>");
              break;
            }
            closeEventStream?.();
            closeEventStream = null;
            config = switchAgent(config, nextAgentId);
            closeEventStream = await startEventStream(config);
            console.log(`switched session to ${config.agentId}`);
            break;
          }
          case "events": {
            const mode = parsed.args[0];
            if (mode === "on") {
              closeEventStream?.();
              closeEventStream = await startEventStream(config);
              console.log(`events enabled for ${config.agentId}`);
              break;
            }
            if (mode === "off") {
              closeEventStream?.();
              closeEventStream = null;
              console.log("events disabled");
              break;
            }
            console.log("usage: /events on|off");
            break;
          }
          case "quit":
            return;
        }
        continue;
      }

      process.stdout.write("assistant> ");
      await streamChat(config, line, {
        onChunk: (chunk) => {
          process.stdout.write(chunk);
        },
        onEnd: () => {
          process.stdout.write("\n");
        },
        onError: (message) => {
          process.stdout.write(`\n[chat error] ${message}\n`);
        },
      });
    }
  } finally {
    closeEventStream?.();
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function startEventStream(config: ChumpConfig): Promise<(() => void) | null> {
  try {
    return await openEventStream(config, {
      onEvent: (event) => logEvent(event),
      onError: (error) => console.error(`[events] ${error.message}`),
    });
  } catch (error) {
    console.error(
      `[events] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function logEvent(event: SseEvent): void {
  const payload = parseEventPayload(event.data);

  if (event.event === "tool_call" && payload) {
    const toolName = readToolName(payload);
    const args = payload.args ?? payload.payload;
    const renderedArgs = args ? compactJson(args) : "";
    console.log(`\n[tool:start] ${toolName}${renderedArgs ? ` ${renderedArgs}` : ""}`);
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
    console.log(`\n[tool:${ok}] ${toolName} ${preview}`);
    return;
  }

  if (event.event === "status" && payload) {
    if (payload.phase === "step_start") {
      console.log(`\n[step ${payload.step}] start`);
      return;
    }
    if (payload.phase === "step_finish") {
      const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls.length : 0;
      const toolResults = Array.isArray(payload.tool_results) ? payload.tool_results.length : 0;
      console.log(`\n[step ${payload.step}] finish tools=${toolCalls} results=${toolResults}`);
      return;
    }
  }

  const label = event.id ? `${event.event}#${event.id}` : event.event;
  const data = event.data ? safeJson(event.data) : "";
  console.log(`\n[event ${label}] ${data}`);
}

function safeJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
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

function renderStoredMessages(
  messages: Array<{ role: string; content: unknown }>,
): void {
  if (messages.length === 0) {
    console.log("(no stored messages)");
    return;
  }

  for (const [index, message] of messages.entries()) {
    console.log(`[${index + 1}] ${message.role}`);
    console.log(formatStoredContent(message.content));
  }
}

function renderSessions(
  sessions: Array<{
    id: string;
    active: boolean;
    message_count: number;
    event_count: number;
    last_user_goal: string | null;
  }>,
): void {
  if (sessions.length === 0) {
    console.log("(no stored sessions)");
    return;
  }

  for (const session of sessions) {
    const active = session.active ? "active" : "stored";
    const goal = session.last_user_goal ? ` ${session.last_user_goal}` : "";
    console.log(
      `${session.id} ${active} messages=${session.message_count} events=${session.event_count}${goal}`,
    );
  }
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

function renderServerStatus(
  health: unknown,
  status: unknown,
  metadata: ManagedServerMetadata | null,
): void {
  if (!metadata) {
    console.log(JSON.stringify({
      health,
      agent: status,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    server: metadata,
    health,
    agent: status,
  }, null, 2));
}
