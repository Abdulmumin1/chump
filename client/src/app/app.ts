import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  abortCurrentTurn,
  cancelLastSteering,
  clearMessages,
  getEventLog,
  getHealth,
  getMessages,
  getSessions,
  getStatus,
  loadSkill,
  setModel,
  setReasoning,
  steerCurrentTurn,
  streamChat,
} from "../api/http.ts";
import {
  parseSlashCommand,
  printHelp,
  switchAgent,
} from "./commands.ts";
import { connectProvider, readGlobalAuth } from "./auth.ts";
import { logClientEvent } from "./diagnostics.ts";
import { listModelChoices } from "./models.ts";
import {
  createSessionId,
  loadConfig,
  renderBanner,
  resolveWorkspaceRoot,
} from "./config.ts";
import {
  consumeToolActivity,
  setAgentStatusHook,
  setAssistantTextHook,
  setReasoningActivityHook,
  setSteeringAcceptedHook,
  setSteeringQueueHook,
  setToolActivityHook,
  setTurnStatusHook,
  setUserMessageHook,
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
  renderUserMessage,
} from "../ui/render.ts";
import { LiveReasoningStream } from "../ui/reasoning.ts";
import { clearTerminal, writeOutput } from "../ui/terminal.ts";
import {
  ensureServerTarget,
  parseCliArgs,
  printCliUsage,
  startServerCommand,
  stopManagedServer,
} from "./runtime.ts";
import { createSpinner } from "../ui/spinner.ts";
import type { ChumpConfig, ManagedServerMetadata, PromptSubmission } from "../core/types.ts";

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
    agentId: options.sessionId ?? undefined,
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
  const liveSync = new LiveSyncTracker();
  let closeEventStream: (() => void) | null = null;
  let activeSteerHandler: ((submission: PromptSubmission) => Promise<boolean>) | null = null;
  let resumeSessionId: string | null = null;
  const [health, status, sessions] = await Promise.all([
    getHealth(config),
    getStatus(config),
    getSessions(config),
  ]);
  promptReader.setFooter(renderFooter(config, status));
  promptReader.setSessionSuggestions(sessions.sessions);
  promptReader.setModelSuggestions(await loadModelSuggestions());
  promptReader.setSkillSuggestions(health.skills);
  promptReader.setAbortHandler(null);
  promptReader.setQueuedLinePopHandler(() => {
    lineQueue.popLast();
  });
  setUserMessageHook((payload) => liveSync.suppressUserMessage(payload));
  setAgentStatusHook((payload) => {
    promptReader.setFooter(renderFooter(config, payload as {
      provider: string;
      model: string;
      reasoning: Record<string, unknown> | null;
    }));
  });
  setSteeringQueueHook((payload) => {
    promptReader.setQueuedDisplay(steeringQueueSubmissions(payload));
  });
  const sharedTurnSync = createSharedTurnSync({
    config: () => config,
    liveSync,
    promptReader,
    getLocalTurnActive: () => liveSync.hasLocalTurn(),
    getActiveSteerHandler: () => activeSteerHandler,
    setActiveSteerHandler: (handler) => {
      activeSteerHandler = handler;
    },
    popQueuedLine: () => lineQueue.popLast(),
  });
  sharedTurnSync.install();
  setAssistantTextHook(() => {
    sharedTurnSync.beforeAssistantText();
    return liveSync.suppressAssistantText();
  });

  if (status.turn_running) {
    sharedTurnSync.applyTurnStatus({
      running: true,
      steering_queue: status.steering_queue ?? [],
    });
  }
  if (status.steering_queue?.length) {
    promptReader.setQueuedDisplay(steeringQueueSubmissions({ items: status.steering_queue }));
  }

  if (target.note) {
    console.log(`[server] ${target.note}`);
  }
  console.log(renderBanner(config));
  renderLoadedResources(health, config.workspaceRoot);
  closeEventStream = await startEventStream(config);
  if (options.sessionId) {
    await renderSwitchedSession(config, (footer) => promptReader.setFooter(footer), (sessionsList) => {
      promptReader.setSessionSuggestions(sessionsList);
    }, {
      skipEmptyTranscript: true,
    });
    promptReader.setSkillSuggestions((await getHealth(config)).skills);
  }

  void readInputLoop(
    promptReader,
    lineQueue,
    () => activeSteerHandler,
    () => promptReader.popQueuedDisplay(),
  );

  try {
    while (true) {
      const nextLine = await lineQueue.shift();
      if (nextLine === null) {
        resumeSessionId = config.agentId;
        break;
      }
      promptReader.popQueuedDisplay();

      const line = nextLine.text;
      if (!line.trim() && nextLine.attachments.length === 0) {
        continue;
      }
      writeOutput(`${renderUserMessage(formatSubmissionForDisplay(nextLine))}\n`);

      const commandResult = await handleSlashCommand(line, {
        config,
        closeEventStream,
        metadata: target.metadata,
        setFooter: (footer) => promptReader.setFooter(footer),
        setSessionSuggestions: (sessionsList) => promptReader.setSessionSuggestions(sessionsList),
        setModelSuggestions: (models) => promptReader.setModelSuggestions(models),
        setSkillSuggestions: (skills) => promptReader.setSkillSuggestions(skills),
        restartEventStream: async (nextConfig) => {
          closeEventStream?.();
          closeEventStream = await startEventStream(nextConfig);
          return closeEventStream;
        },
      });

      if (commandResult === "quit") {
        resumeSessionId = config.agentId;
        break;
      }

      if (commandResult) {
        config = commandResult.config;
        closeEventStream = commandResult.closeEventStream;
        if (commandResult.submission) {
          await runChatTurn(
            config,
            commandResult.submission,
            liveSync,
            (status) => promptReader.setStatus(status),
            (handler) => promptReader.setAbortHandler(handler),
            (handler) => {
              activeSteerHandler = handler;
            },
            () => promptReader.popQueuedDisplay(),
            (handler) => {
              promptReader.setQueuedLinePopHandler(
                handler
                  ? () => {
                      handler();
                    }
                  : () => {
                      lineQueue.popLast();
                    },
              );
            },
            (submission) => lineQueue.unshift(submission),
          );
          promptReader.setQueuedLinePopHandler(() => {
            lineQueue.popLast();
          });
          sharedTurnSync.install();
        }
        continue;
      }

      await runChatTurn(
        config,
        nextLine,
        liveSync,
        (status) => promptReader.setStatus(status),
        (handler) => promptReader.setAbortHandler(handler),
        (handler) => {
          activeSteerHandler = handler;
        },
        () => promptReader.popQueuedDisplay(),
        (handler) => {
          promptReader.setQueuedLinePopHandler(
            handler
              ? () => {
                  handler();
                }
              : () => {
                  lineQueue.popLast();
                },
          );
        },
        (submission) => lineQueue.unshift(submission),
      );
      promptReader.setQueuedLinePopHandler(() => {
        lineQueue.popLast();
      });
      sharedTurnSync.install();
    }
  } finally {
    promptReader.close();
    closeEventStream?.();
    setUserMessageHook(null);
    setAssistantTextHook(null);
    setAgentStatusHook(null);
    setSteeringQueueHook(null);
    sharedTurnSync.dispose();
  }

  if (resumeSessionId) {
    writeOutput(`${renderMuted(`resume this session with: ${formatResumeCommand(resumeSessionId)}`)}\n`);
  }
}

function renderLoadedResources(
  health: { instruction_files: string[]; skills: unknown[] },
  workspaceRoot: string,
): void {
  const instructionFiles = health.instruction_files ?? [];

  if (instructionFiles.length > 0) {
    writeOutput(`${renderMuted(`context: ${formatResourcePaths(instructionFiles, workspaceRoot)}`)}\n`);
  }
  if (instructionFiles.length > 0) {
    writeOutput("\n");
  }
}

function formatResourcePaths(paths: string[], workspaceRoot: string): string {
  return formatCompactNames(
    paths.map((value) => {
      if (value.startsWith(`${workspaceRoot}/`)) {
        return value.slice(workspaceRoot.length + 1);
      }
      return value.replace(/^.*\//, "");
    }),
  );
}

function formatCompactNames(values: string[], limit = 4): string {
  if (values.length <= limit) {
    return values.join(", ");
  }
  const visible = values.slice(0, limit).join(", ");
  return `${visible}, ${values.length - limit} more`;
}

async function runChatTurn(
  config: ChumpConfig,
  submission: PromptSubmission,
  liveSync: LiveSyncTracker,
  setStatus: (status: string | null) => void,
  setAbortHandler: (handler: (() => void) | null) => void,
  setSteerHandler: (handler: ((submission: PromptSubmission) => Promise<boolean>) | null) => void,
  popSteeredDisplay: () => void,
  setQueuedLinePopHandler: (handler: (() => void) | null) => void,
  requeueSteeredSubmission: (submission: PromptSubmission) => void,
): Promise<void> {
  const streamAbortController = new AbortController();
  liveSync.noteLocalChat(formatSubmissionForDisplay(submission));
  liveSync.beginLocalTurn();
  let spinnerFrame: string | null = null;
  let reasoningPreview: string | null = null;
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
  const flushAssistantTranscript = (): void => {
    markdownStream?.end();
    markdownStream = null;
  };
  const syncStatus = (): void => {
    const lines: string[] = [];
    if (reasoningPreview) {
      lines.push(reasoningPreview, "");
    }
    if (spinnerFrame) {
      lines.push(spinnerFrame, "");
    }
    if (lines.length > 0) {
      lines.unshift("");
    }
    setStatus(lines.length > 0 ? lines.join("\n") : null);
  };
  const spinner = createSpinner((frame) => {
    spinnerFrame = frame;
    syncStatus();
  });
  const reasoningStream = new LiveReasoningStream({
    onPreview: (preview) => {
      reasoningPreview = preview;
      syncStatus();
    },
  });
  const pendingSteeringSubmissions: PromptSubmission[] = [];
  const popPendingSteeringSubmission = (): void => {
    const pending = pendingSteeringSubmissions.pop() ?? null;
    if (!pending) {
      return;
    }
    void cancelLastSteering(config).catch(() => {});
  };
  setAbortHandler(abortTurn);
  setQueuedLinePopHandler(popPendingSteeringSubmission);
  setSteeringAcceptedHook((content) => {
    removePendingSteeringSubmission(content);
    popSteeredDisplay();
  });
  setSteerHandler(async (nextSubmission) => {
    const result = await steerCurrentTurn(
      config,
      nextSubmission.text,
      nextSubmission.attachments,
    );
    if (result.status !== "steered") {
      return false;
    }
    liveSync.noteLocalSteer(formatSubmissionForDisplay(nextSubmission));
    pendingSteeringSubmissions.push(nextSubmission);
    return true;
  });
  spinner.start();
  setToolActivityHook(() => {
    flushAssistantTranscript();
    reasoningStream.finish();
    spinner.refresh();
  });
  setReasoningActivityHook((payload) => {
    reasoningStream.render(payload);
  });
  let receivedChunk = false;
  let receivedEnd = false;

  try {
    logClientEvent(
      "chatSubmit",
      `chars=${submission.text.length} attachments=${submission.attachments.length}`,
    );
    await streamChat(config, submission.text, submission.attachments, {
      onChunk: (chunk) => {
        reasoningStream.finish();
        spinner.stop();
        receivedChunk = true;
        if (consumeToolActivity()) {
          writeOutput("\n");
        }
        markdownStream ??= createMarkdownStream();
        markdownStream.write(chunk);
      },
      onEnd: () => {
        receivedEnd = true;
        reasoningStream.finish();
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
        receivedEnd = true;
        reasoningStream.finish();
        spinner.stop();
        if (aborting || /aborted/i.test(message)) {
          writeOutput(`${renderMuted("(aborted)")}\n`);
          return;
        }
        writeOutput(`\n${renderError(`[chat] ${message}`)}\n`);
      },
    }, streamAbortController.signal);
    if (!receivedEnd && !aborting) {
      await abortCurrentTurn(config).catch(() => {});
      throw new Error("chat stream ended before the server sent an end event");
    }
  } catch (error) {
    reasoningStream.finish();
    spinner.stop();
    flushAssistantTranscript();
    if (!receivedEnd && !aborting) {
      await abortCurrentTurn(config).catch(() => {});
    }
    const message = errorMessage(error);
    if (aborting || /aborted/i.test(message)) {
      writeOutput(`${renderMuted("(aborted)")}\n`);
      return;
    }
    writeOutput(`\n${renderError(`[chat] ${message}`)}\n`);
  } finally {
    streamAbortController.abort();
    liveSync.endLocalTurn();
    reasoningStream.finish();
    spinner.stop();
    setAbortHandler(null);
    setSteerHandler(null);
    setQueuedLinePopHandler(null);
    setSteeringAcceptedHook(null);
    while (pendingSteeringSubmissions.length > 0) {
      const pending = pendingSteeringSubmissions.pop();
      if (pending) {
        requeueSteeredSubmission(pending);
      }
    }
    setToolActivityHook(null);
    setReasoningActivityHook(null);
  }

  function removePendingSteeringSubmission(content: string): void {
    const index = pendingSteeringSubmissions.findIndex((item) => item.text === content);
    if (index === -1) {
      return;
    }
    pendingSteeringSubmissions.splice(index, 1);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatSubmissionForDisplay(submission: PromptSubmission): string {
  let text = submission.text;
  for (const attachment of submission.attachments) {
    if (attachment.type === "text") {
      text = text.replace(attachment.text, attachment.label);
    }
  }
  const images = submission.attachments
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => attachment.label)
    .filter((label) => !text.includes(label))
    .join(" ");
  if (!images) {
    return text;
  }
  return `${text.trimEnd()} ${images}`.trim();
}

class LiveSyncTracker {
  private readonly localChats: string[] = [];
  private readonly localSteers: string[] = [];
  private localTurnCount = 0;

  noteLocalChat(content: string): void {
    this.push(this.localChats, content);
  }

  noteLocalSteer(content: string): void {
    this.push(this.localSteers, content);
  }

  beginLocalTurn(): void {
    this.localTurnCount += 1;
  }

  endLocalTurn(): void {
    this.localTurnCount = Math.max(0, this.localTurnCount - 1);
  }

  hasLocalTurn(): boolean {
    return this.localTurnCount > 0;
  }

  suppressUserMessage(payload: Record<string, unknown>): boolean {
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    if (!content) {
      return true;
    }

    if (payload.steered === true) {
      this.consume(this.localSteers, content);
      return false;
    }

    return this.consume(this.localChats, content);
  }

  suppressAssistantText(): boolean {
    return this.localTurnCount > 0;
  }

  private push(queue: string[], content: string): void {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }
    queue.push(normalized);
    if (queue.length > 16) {
      queue.splice(0, queue.length - 16);
    }
  }

  private consume(queue: string[], content: string): boolean {
    const index = queue.findIndex((item) => item === content);
    if (index === -1) {
      return false;
    }
    queue.splice(index, 1);
    return true;
  }
}

function createSharedTurnSync(options: {
  config: () => ChumpConfig;
  liveSync: LiveSyncTracker;
  promptReader: ReturnType<typeof createPromptReader>;
  getLocalTurnActive: () => boolean;
  getActiveSteerHandler: () => ((submission: PromptSubmission) => Promise<boolean>) | null;
  setActiveSteerHandler: (handler: ((submission: PromptSubmission) => Promise<boolean>) | null) => void;
  popQueuedLine: () => PromptSubmission | null;
}): {
  install: () => void;
  dispose: () => void;
  applyTurnStatus: (payload: Record<string, unknown>) => void;
  beforeAssistantText: () => void;
} {
  let remoteTurnRunning = false;
  let spinnerFrame: string | null = null;
  let reasoningPreview: string | null = null;
  const remoteReasoningStream = new LiveReasoningStream({
    onPreview: (preview) => {
      reasoningPreview = preview;
      syncStatus();
    },
  });
  const spinner = createSpinner((frame) => {
    spinnerFrame = frame;
    syncStatus();
  });
  const remoteSteerHandler = async (submission: PromptSubmission): Promise<boolean> => {
    const result = await steerCurrentTurn(
      options.config(),
      submission.text,
      submission.attachments,
    );
    if (result.status !== "steered") {
      return false;
    }
    options.liveSync.noteLocalSteer(formatSubmissionForDisplay(submission));
    return true;
  };

  const applyTurnStatus = (payload: Record<string, unknown>): void => {
    remoteTurnRunning = payload.running === true;
    if (Array.isArray(payload.steering_queue)) {
      options.promptReader.setQueuedDisplay(
        steeringQueueSubmissions({ items: payload.steering_queue }),
      );
    }

    if (remoteTurnRunning) {
      if (options.getLocalTurnActive()) {
        return;
      }
      spinner.start();
      if (!options.getActiveSteerHandler()) {
        options.setActiveSteerHandler(remoteSteerHandler);
      }
      options.promptReader.setAbortHandler(() => {
        void abortCurrentTurn(options.config()).catch(() => {});
        options.promptReader.setStatus(renderMuted("Aborting..."));
      });
      options.promptReader.setQueuedLinePopHandler(() => {
        void cancelLastSteering(options.config()).catch(() => {});
      });
      syncStatus();
      return;
    }

    spinner.stop();
    remoteReasoningStream.finish();
    spinnerFrame = null;
    reasoningPreview = null;
    if (!options.getLocalTurnActive()) {
      options.promptReader.setStatus(null);
      options.promptReader.setAbortHandler(null);
      options.setActiveSteerHandler(null);
      options.promptReader.setQueuedLinePopHandler(() => {
        options.popQueuedLine();
      });
    }
  };

  const install = (): void => {
    setTurnStatusHook(applyTurnStatus);
    setReasoningActivityHook((payload) => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      remoteReasoningStream.render(payload);
    });
    setToolActivityHook(() => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      remoteReasoningStream.finish();
      spinner.refresh();
    });
  };

  const dispose = (): void => {
    spinner.stop();
    remoteReasoningStream.finish();
    setTurnStatusHook(null);
    setReasoningActivityHook(null);
    setToolActivityHook(null);
  };

  const beforeAssistantText = (): void => {
    if (!remoteTurnRunning || options.getLocalTurnActive()) {
      return;
    }
    spinner.stop();
    spinnerFrame = null;
    options.promptReader.setStatus(null);
    remoteReasoningStream.finish();
    reasoningPreview = null;
  };

  function syncStatus(): void {
    if (!remoteTurnRunning || options.getLocalTurnActive()) {
      return;
    }
    const lines: string[] = [];
    if (reasoningPreview) {
      lines.push(reasoningPreview, "");
    }
    if (spinnerFrame) {
      lines.push(spinnerFrame, "");
    }
    if (lines.length > 0) {
      lines.unshift("");
    }
    options.promptReader.setStatus(lines.length > 0 ? lines.join("\n") : null);
  }

  return { install, dispose, applyTurnStatus, beforeAssistantText };
}

async function readInputLoop(
  promptReader: ReturnType<typeof createPromptReader>,
  lineQueue: AsyncLineQueue,
  getSteerHandler: () => ((submission: PromptSubmission) => Promise<boolean>) | null,
  popQueuedDisplay: () => void,
): Promise<void> {
  try {
    while (true) {
      const line = await promptReader.read();
      if (line === null) {
        lineQueue.close();
        return;
      }
      const steerHandler = getSteerHandler();
      if (steerHandler && shouldSteer(line)) {
        const steered = await steerHandler(line).catch(() => false);
        if (steered) {
          continue;
        }
      }
      if (steerHandler && isBlockedActiveSlashCommand(line.text)) {
        popQueuedDisplay();
        writeOutput(`${renderError("[slash] command is unavailable while the agent is working; use Esc Esc to abort first")}\n`);
        continue;
      }
      lineQueue.push(line);
    }
  } catch (error) {
    lineQueue.fail(error);
  }
}

function shouldSteer(submission: PromptSubmission): boolean {
  if (!submission.text.trim() && submission.attachments.length === 0) {
    return false;
  }
  return !submission.text.trimStart().startsWith("/");
}

function isBlockedActiveSlashCommand(value: string): boolean {
  const command = value.trimStart().split(/\s+/, 1)[0];
  return new Set([
    "/sessions",
    "/session",
    "/new",
    "/model",
    "/thinking",
    "/clear",
    "/agent",
  ]).has(command);
}

class AsyncLineQueue {
  private lines: PromptSubmission[] = [];
  private waiting: ((value: PromptSubmission | null) => void) | null = null;
  private closed = false;
  private error: unknown = null;

  push(line: PromptSubmission): void {
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

  unshift(line: PromptSubmission): void {
    if (this.closed) {
      return;
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(line);
      return;
    }
    this.lines.unshift(line);
  }

  popLast(): PromptSubmission | null {
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

  async shift(): Promise<PromptSubmission | null> {
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
    setSkillSuggestions: (skills: Awaited<ReturnType<typeof getHealth>>["skills"]) => void;
    restartEventStream: (config: ChumpConfig) => Promise<(() => void) | null>;
  },
): Promise<false | "quit" | {
  config: ReturnType<typeof loadConfig>;
  closeEventStream: (() => void) | null;
  submission?: PromptSubmission;
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
      const status = await setModel(config, provider, model);
      context.setFooter(renderFooter(config, status));
      context.setModelSuggestions(await loadModelSuggestions());
      writeOutput(`${renderMuted(`model set to ${status.provider}/${status.model}`)}\n`);
      break;
    }
    case "skill": {
      const [name, ...rest] = parsed.args;
      if (!name) {
        writeOutput(`${renderMuted("usage: /skill:<name> [args]")}\n`);
        break;
      }
      const skill = await loadSkill(config, name, rest.join(" "));
      return {
        config,
        closeEventStream,
        submission: {
          text: skill.prompt,
          attachments: [],
        },
      };
    }
    case "thinking": {
      const mode = parsed.args[0];
      if (!isThinkingMode(mode)) {
        writeOutput(`${renderMuted("usage: /thinking <none|low|high|xhigh>")}\n`);
        break;
      }
      const status = await setReasoning(config, mode);
      context.setFooter(renderFooter(config, status));
      writeOutput(`${renderMuted(`thinking set to ${mode}`)}\n`);
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
        context.setSkillSuggestions((await getHealth(config)).skills);
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      clearTerminal();
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      await renderSwitchedSession(config, context.setFooter, context.setSessionSuggestions);
      context.setSkillSuggestions((await getHealth(config)).skills);
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
      context.setSkillSuggestions((await getHealth(config)).skills);
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

function isThinkingMode(value: string | undefined): value is "none" | "low" | "high" | "xhigh" {
  return value === "none" || value === "low" || value === "high" || value === "xhigh";
}

async function renderSwitchedSession(
  config: ChumpConfig,
  setFooter: (footer: string | null) => void,
  setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void,
  options: { skipEmptyTranscript?: boolean } = {},
): Promise<void> {
  const [health, status, response, sessions] = await Promise.all([
    getHealth(config),
    getStatus(config),
    getMessages(config),
    getSessions(config),
  ]);
  setFooter(renderFooter(config, status));
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

function steeringQueueSubmissions(payload: Record<string, unknown>): PromptSubmission[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const submissions: PromptSubmission[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const value = item as Record<string, unknown>;
    const text = typeof value.content === "string" ? value.content : "";
    const attachments = Array.isArray(value.attachments) ? value.attachments : [];
    submissions.push({
      text,
      attachments: attachments
        .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
        .map((attachment) => {
          const label = typeof attachment.label === "string" ? attachment.label : "[attachment]";
          return { type: "text", label, text: label };
        }),
    });
  }
  return submissions;
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

function formatResumeCommand(sessionId: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(sessionId)) {
    return `chump -s ${sessionId}`;
  }
  return `chump -s '${sessionId.replace(/'/g, `'\\''`)}'`;
}
