import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  clearMessages,
  getEventLog,
  getHealth,
  getMessages,
  getSessions,
  getState,
  getStatus,
  streamChat,
} from "../api/http.ts";
import {
  parseSlashCommand,
  printHelp,
  switchAgent,
} from "./commands.ts";
import {
  createSessionId,
  loadConfig,
  renderBanner,
  resolveWorkspaceRoot,
} from "./config.ts";
import {
  consumeToolActivity,
  setToolActivityHook,
  startEventStream,
} from "../ui/events.ts";
import { createPromptReader } from "../ui/input.ts";
import {
  renderSessionTranscript,
  renderServerStatus,
  renderSessions,
  renderStoredMessages,
} from "../ui/output.ts";
import {
  createMarkdownStream,
  renderError,
  renderFooterStatus,
  renderMuted,
  renderUserMessage,
} from "../ui/render.ts";
import { writeOutput } from "../ui/terminal.ts";
import {
  ensureServerTarget,
  parseCliArgs,
  printCliUsage,
  startServerCommand,
  stopManagedServer,
} from "./runtime.ts";
import { createSpinner } from "../ui/spinner.ts";
import type { ChumpConfig, ManagedServerMetadata } from "../core/types.ts";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
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

  const fallbackRl = input.isTTY ? null : createInterface({ input, output });
  const promptReader = createPromptReader(fallbackRl);
  const lineQueue = new AsyncLineQueue();
  let closeEventStream: (() => void) | null = null;
  const [health, sessions] = await Promise.all([
    getHealth(config),
    getSessions(config),
  ]);
  promptReader.setFooter(renderFooter(config, health));
  promptReader.setSessionSuggestions(sessions.sessions);

  if (target.note) {
    console.log(`[server] ${target.note}`);
  }
  console.log(renderBanner(config));
  closeEventStream = await startEventStream(config);

  void readInputLoop(promptReader, lineQueue);

  try {
    while (true) {
      const nextLine = await lineQueue.shift();
      if (nextLine === null) {
        break;
      }
      promptReader.popQueuedDisplay();

      const line = nextLine;
      if (!line.trim()) {
        continue;
      }
      writeOutput(`${renderUserMessage(line)}\n`);

      const commandResult = await handleSlashCommand(line, {
        config,
        closeEventStream,
        metadata: target.metadata,
        setFooter: (footer) => promptReader.setFooter(footer),
        setSessionSuggestions: (sessionsList) => promptReader.setSessionSuggestions(sessionsList),
        restartEventStream: async (nextConfig) => {
          closeEventStream?.();
          closeEventStream = await startEventStream(nextConfig);
          return closeEventStream;
        },
      });

      if (commandResult === "quit") {
        return;
      }

      if (commandResult) {
        config = commandResult.config;
        closeEventStream = commandResult.closeEventStream;
        continue;
      }

      await runChatTurn(config, line, (status) => promptReader.setStatus(status));
    }
  } finally {
    promptReader.close();
    closeEventStream?.();
  }
}

async function runChatTurn(
  config: ChumpConfig,
  line: string,
  setStatus: (status: string | null) => void,
): Promise<void> {
  const spinner = createSpinner(setStatus);
  spinner.start();
  setToolActivityHook(() => spinner.start());
  let receivedChunk = false;
  let separatedFromTools = false;
  let markdownStream: ReturnType<typeof createMarkdownStream> | null = null;

  try {
    await streamChat(config, line, {
      onChunk: (chunk) => {
        spinner.stop();
        receivedChunk = true;
        if (!separatedFromTools) {
          if (consumeToolActivity()) {
            writeOutput("\n");
          }
          separatedFromTools = true;
        }
        markdownStream ??= createMarkdownStream();
        markdownStream.write(chunk);
      },
      onEnd: () => {
        spinner.stop();
        if (!receivedChunk) {
          writeOutput(`${renderMuted("(no response)")}\n`);
          return;
        }
        markdownStream?.end();
      },
      onError: (message) => {
        spinner.stop();
        writeOutput(`\n${renderError(`[chat] ${message}`)}\n`);
      },
    });
  } finally {
    spinner.stop();
    setToolActivityHook(null);
  }
}

async function readInputLoop(
  promptReader: ReturnType<typeof createPromptReader>,
  lineQueue: AsyncLineQueue,
): Promise<void> {
  try {
    while (true) {
      const line = await promptReader.read();
      if (line === null) {
        lineQueue.close();
        return;
      }
      lineQueue.push(line);
    }
  } catch (error) {
    lineQueue.fail(error);
  }
}

class AsyncLineQueue {
  private lines: string[] = [];
  private waiting: ((value: string | null) => void) | null = null;
  private closed = false;
  private error: unknown = null;

  push(line: string): void {
    if (this.closed) {
      return;
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(line);
      return;
    }
    this.lines.push(line);
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(null);
    }
  }

  fail(error: unknown): void {
    this.error = error;
    this.close();
  }

  async shift(): Promise<string | null> {
    if (this.error) {
      throw this.error;
    }
    const line = this.lines.shift();
    if (line !== undefined) {
      return line;
    }
    if (this.closed) {
      return null;
    }
    return await new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

async function handleSlashCommand(
  line: string,
  context: {
    config: ReturnType<typeof loadConfig>;
    closeEventStream: (() => void) | null;
    metadata: ManagedServerMetadata | null;
    setFooter: (footer: string | null) => void;
    setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void;
    restartEventStream: (config: ChumpConfig) => Promise<(() => void) | null>;
  },
): Promise<false | "quit" | {
  config: ReturnType<typeof loadConfig>;
  closeEventStream: (() => void) | null;
}> {
  const parsed = parseSlashCommand(line);
  if (!parsed) {
    return false;
  }

  let config = context.config;
  let closeEventStream = context.closeEventStream;

  switch (parsed.command) {
    case "help":
      printHelp();
      break;
    case "status": {
      const [health, status] = await Promise.all([
        getHealth(config),
        getStatus(config),
      ]);
      context.setFooter(renderFooter(config, health));
      renderServerStatus(health, status, context.metadata);
      break;
    }
    case "state": {
      const state = await getState(config);
      writeOutput(`${JSON.stringify(state, null, 2)}\n`);
      break;
    }
    case "messages": {
      const response = await getMessages(config);
      renderStoredMessages(response.messages);
      break;
    }
    case "sessions": {
      const response = await getSessions(config);
      context.setSessionSuggestions(response.sessions);
      renderSessions(response.sessions);
      break;
    }
    case "clear": {
      const result = await clearMessages(config);
      writeOutput(`${JSON.stringify(result, null, 2)}\n`);
      break;
    }
    case "session": {
      const mode = parsed.args[0];
      if (!mode) {
        writeOutput(`${renderMuted(`current session: ${config.agentId}`)}\n`);
        break;
      }

      if (mode === "new") {
        config = switchAgent(config, createSessionId(config.workspaceRoot));
        closeEventStream = await context.restartEventStream(config);
        writeOutput(`${renderMuted(`started new session ${config.agentId}`)}\n`);
        await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions);
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions);
      break;
    }
    case "agent": {
      const nextAgentId = parsed.args[0];
      if (!nextAgentId) {
        writeOutput(`${renderMuted("usage: /agent <id>")}\n`);
        break;
      }
      config = switchAgent(config, nextAgentId);
      closeEventStream = await context.restartEventStream(config);
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions);
      break;
    }
    case "events": {
      const mode = parsed.args[0];
      if (mode === "on") {
        closeEventStream?.();
        closeEventStream = await startEventStream(config);
        writeOutput(`${renderMuted(`events enabled for ${config.agentId}`)}\n`);
        break;
      }
      if (mode === "off") {
        closeEventStream?.();
        closeEventStream = null;
        writeOutput(`${renderMuted("events disabled")}\n`);
        break;
      }
      writeOutput(`${renderMuted("usage: /events on|off")}\n`);
      break;
    }
    case "quit":
      return "quit";
  }

  return { config, closeEventStream };
}

async function renderSwitchedSession(
  config: ChumpConfig,
  setFooter: (footer: string | null) => void,
  setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void,
): Promise<void> {
  const [health, response, sessions] = await Promise.all([
    getHealth(config),
    getMessages(config),
    getSessions(config),
  ]);
  setFooter(renderFooter(config, health));
  setSessionSuggestions(sessions.sessions);
  const eventLog = await getEventLog(config);
  renderSessionTranscript(response.messages, eventLog.events);
}

function renderFooter(
  config: ChumpConfig,
  health: { provider: string; model: string; reasoning: Record<string, unknown> | null },
): string {
  return renderFooterStatus([
    `${health.provider}/${health.model}`,
    renderReasoning(health.reasoning),
    config.serverSource,
    config.agentId,
  ]);
}

function renderReasoning(reasoning: Record<string, unknown> | null): string {
  if (!reasoning) {
    return "";
  }
  const parts = [
    typeof reasoning.effort === "string" ? reasoning.effort : null,
    typeof reasoning.budget === "number" ? `${reasoning.budget} tok` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `thinking ${parts.join(" ")}` : "thinking";
}
