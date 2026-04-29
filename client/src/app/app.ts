import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  abortCurrentTurn,
  clearMessages,
  getEventLog,
  getHealth,
  getMessages,
  getSessions,
  getStatus,
  setModel,
  streamChat,
} from "../api/http.ts";
import {
  parseSlashCommand,
  printHelp,
  switchAgent,
} from "./commands.ts";
import { connectProvider, readGlobalAuth, updateGlobalAuth } from "./auth.ts";
import { listModelChoices } from "./models.ts";
import {
  createSessionId,
  loadConfig,
  renderBanner,
  resolveWorkspaceRoot,
} from "./config.ts";
import {
  consumeToolActivity,
  setReasoningActivityHook,
  setToolActivityHook,
  startEventStream,
} from "../ui/events.ts";
import { createPromptReader } from "../ui/input.ts";
import {
  renderSessionTranscript,
  renderServerStatus,
  renderSessions,
} from "../ui/output.ts";
import {
  createMarkdownStream,
  renderError,
  renderFooterStatus,
  renderMuted,
  renderThinkingBlock,
  renderUserMessage,
} from "../ui/render.ts";
import { clearTerminal, writeOutput } from "../ui/terminal.ts";
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

  if (options.mode === "connect") {
    await connectProvider();
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
  promptReader.setModelSuggestions(await loadModelSuggestions());
  promptReader.setAbortHandler(null);
  promptReader.setQueuedLinePopHandler(() => lineQueue.popLast());

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
        setModelSuggestions: (models) => promptReader.setModelSuggestions(models),
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

      await runChatTurn(
        config,
        line,
        (status) => promptReader.setStatus(status),
        (handler) => promptReader.setAbortHandler(handler),
      );
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
  setAbortHandler: (handler: (() => void) | null) => void,
): Promise<void> {
  const streamAbortController = new AbortController();
  let spinnerFrame: string | null = null;
  let reasoningTitle: string | null = null;
  let reasoningBuffer = "";
  let markdownStream: ReturnType<typeof createMarkdownStream> | null = null;
  let aborting = false;
  const abortTurn = (): void => {
    if (aborting) {
      return;
    }
    aborting = true;
    void abortCurrentTurn(config).catch(() => {});
    setStatus(renderMuted("Aborting..."));
  };
  const hasReasoning = (): boolean => Boolean(reasoningTitle || reasoningBuffer.trim());
  const clearReasoning = (): void => {
    reasoningTitle = null;
    reasoningBuffer = "";
  };
  const flushReasoningTranscript = (): void => {
    if (!hasReasoning()) {
      return;
    }
    const block = renderThinkingBlock(
      reasoningTitle,
      reasoningBuffer,
    );
    clearReasoning();
    syncStatus();
    writeOutput(`\n${block.join("\n")}\n\n`);
  };
  const flushAssistantTranscript = (): void => {
    markdownStream?.end();
    markdownStream = null;
  };
  const syncStatus = (): void => {
    const lines: string[] = [];
    if (reasoningTitle || reasoningBuffer.trim()) {
      lines.push(...renderThinkingBlock(
        reasoningTitle,
        reasoningBuffer,
      ));
    }
    if (spinnerFrame) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(spinnerFrame, "");
    }
    setStatus(lines.length > 0 ? lines.join("\n") : null);
  };
  const spinner = createSpinner((frame) => {
    spinnerFrame = frame;
    syncStatus();
  });
  setAbortHandler(abortTurn);
  spinner.start();
  setToolActivityHook(() => {
    flushAssistantTranscript();
    flushReasoningTranscript();
    spinner.start();
  });
  setReasoningActivityHook((payload) => {
    if (typeof payload.text !== "string" || payload.text.length === 0) {
      return;
    }
    if (payload.kind === "summary") {
      reasoningTitle = payload.text.trim() || reasoningTitle;
    } else {
      reasoningBuffer += payload.text;
    }
    syncStatus();
  });
  let receivedChunk = false;

  try {
    await streamChat(config, line, {
      onChunk: (chunk) => {
        flushReasoningTranscript();
        spinner.stop();
        receivedChunk = true;
        if (consumeToolActivity()) {
          writeOutput("\n");
        }
        markdownStream ??= createMarkdownStream();
        markdownStream.write(chunk);
      },
      onEnd: () => {
        flushReasoningTranscript();
        spinner.stop();
        if (aborting && !receivedChunk) {
          writeOutput(`${renderMuted("(aborted)")}\n`);
          return;
        }
        if (!receivedChunk) {
          writeOutput(`${renderMuted("(no response)")}\n`);
          return;
        }
        flushAssistantTranscript();
      },
      onError: (message) => {
        flushReasoningTranscript();
        spinner.stop();
        if (aborting || /aborted/i.test(message)) {
          writeOutput(`${renderMuted("(aborted)")}\n`);
          return;
        }
        writeOutput(`\n${renderError(`[chat] ${message}`)}\n`);
      },
    }, streamAbortController.signal);
  } finally {
    streamAbortController.abort();
    spinner.stop();
    setAbortHandler(null);
    setToolActivityHook(null);
    setReasoningActivityHook(null);
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

  popLast(): string | null {
    return this.lines.pop() ?? null;
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
    setModelSuggestions: (models: Awaited<ReturnType<typeof loadModelSuggestions>>) => void;
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
    case "sessions": {
      const response = await getSessions(config);
      context.setSessionSuggestions(response.sessions);
      renderSessions(response.sessions);
      break;
    }
    case "model": {
      const raw = parsed.args.join(" ");
      const [provider, model] = parseModelSelector(raw);
      if (!provider || !model) {
        writeOutput(`${renderMuted("usage: /model <provider>/<model>")}\n`);
        break;
      }
      await updateGlobalAuth({ provider, model });
      const status = await setModel(config, provider, model);
      context.setFooter(renderFooter(config, status));
      context.setModelSuggestions(await loadModelSuggestions());
      writeOutput(`${renderMuted(`model set to ${status.provider}/${status.model}`)}\n`);
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
        clearTerminal();
        writeOutput(`${renderBanner(config)}\n`);
        await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions, {
          skipEmptyTranscript: true,
        });
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      clearTerminal();
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
      clearTerminal();
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions);
      break;
    }
    case "quit":
      return "quit";
  }

  return { config, closeEventStream };
}

async function loadModelSuggestions(): Promise<Awaited<ReturnType<typeof listModelChoices>>> {
  const auth = await readGlobalAuth();
  const providers = Object.keys(auth.credentials ?? {});
  return await listModelChoices(providers);
}

function parseModelSelector(value: string): [string | null, string | null] {
  const trimmed = value.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return [null, null];
  }
  return [trimmed.slice(0, separator), trimmed.slice(separator + 1)];
}

async function renderSwitchedSession(
  config: ChumpConfig,
  setFooter: (footer: string | null) => void,
  setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void,
  options: { skipEmptyTranscript?: boolean } = {},
): Promise<void> {
  const [health, response, sessions] = await Promise.all([
    getHealth(config),
    getMessages(config),
    getSessions(config),
  ]);
  setFooter(renderFooter(config, health));
  setSessionSuggestions(sessions.sessions);
  if (options.skipEmptyTranscript && response.messages.length === 0) {
    return;
  }
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
