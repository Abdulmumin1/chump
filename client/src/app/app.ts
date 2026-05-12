import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  abortCurrentTurn,
  cancelLastSteering,
  clearMessages,
  getHealth,
  getMessages,
  getSessions,
  getStatus,
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
import { connectProvider, readGlobalAuth, updateGlobalAuth } from "./auth.ts";
import { logClientEvent } from "./diagnostics.ts";
import { listModelChoices } from "./models.ts";
import { ShareManager } from "./share.ts";
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
  renderAccent,
  renderError,
  renderFooterStatus,
  renderMuted,
  renderUserMessage,
  renderWorkedFor,
} from "../ui/render.ts";
import { clearTerminal, writeOutput } from "../ui/terminal.ts";
import { TranscriptRenderer } from "../ui/transcript.ts";
import {
  ensureServerTarget,
  parseCliArgs,
  printCliUsage,
  startServerCommand,
  stopManagedServer,
} from "./runtime.ts";
import { createSpinner } from "../ui/spinner.ts";
import type {
  ChumpConfig,
  ManagedServerMetadata,
  PromptSubmission,
  ShareStatus,
} from "../core/types.ts";

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
  const shareManager = new ShareManager();
  let closeEventStream: (() => void) | null = null;
  let activeSteerHandler: ((submission: PromptSubmission) => Promise<boolean>) | null = null;
  let resumeSessionId: string | null = null;
  let connectionCountAtQuit: number | null = null;
  const [health, status, sessions] = await Promise.all([
    getHealth(config),
    getStatus(config),
    getSessions(config),
  ]);
  promptReader.setFooter(renderFooter(config, status, shareManager.current()));
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
    }, shareManager.current()));
  });
  setSteeringQueueHook((payload) => {
    // Don't update the queued display during a local turn — runChatTurn manages it
    if (!liveSync.hasLocalTurn()) {
      promptReader.setQueuedDisplay(steeringQueueSubmissions(payload));
    }
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
    await renderSwitchedSession(config, shareManager, (footer) => promptReader.setFooter(footer), (sessionsList) => {
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
        shareManager,
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
    if (config.serverSource === "managed") {
      try {
        const preQuitHealth = await getHealth(config);
        connectionCountAtQuit = preQuitHealth.active_connections;
      } catch {
        // ignore
      }
    }
    promptReader.close();
    closeEventStream?.();
    await shareManager.dispose();
    setUserMessageHook(null);
    setAssistantTextHook(null);
    setAgentStatusHook(null);
    setSteeringQueueHook(null);
    sharedTurnSync.dispose();
  }

  if (resumeSessionId) {
    writeOutput(`${renderMuted(`resume this session with: ${formatResumeCommand(resumeSessionId)}`)}\n`);
  }

  if (config.serverSource === "managed" && connectionCountAtQuit !== null) {
    // Subtract 1 for ourselves — the snapshot was taken while we were still connected
    const remaining = Math.max(0, connectionCountAtQuit - 1);
    const idleTimeout = health.managed_idle_timeout;
    const parts: string[] = [];
    if (remaining === 0) {
      parts.push(`server: no clients connected`);
      if (idleTimeout !== null) {
        parts.push(`shutting down in ${idleTimeout}s`);
      }
    } else {
      parts.push(`server: ${remaining} client${remaining === 1 ? "" : "s"} still connected`);
    }
    parts.push(`force stop: chump stop`);
    writeOutput(`${renderMuted(parts.join(" · "))}\n`);
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

function createActivityStatusController(
  setStatus: (status: string | null) => void,
): {
  start: () => void;
  stop: () => void;
  showAborting: () => void;
  beginTextStreaming: () => void;
  noteToolActivity: () => void;
  noteReasoningPreview: (preview: string | null) => void;
} {
  let active = false;
  let aborting = false;
  let spinnerFrame: string | null = null;

  const spinner = createSpinner((frame) => {
    spinnerFrame = frame;
    syncStatus();
  });

  function syncStatus(): void {
    if (!active) {
      setStatus(null);
      return;
    }

    if (aborting) {
      setStatus(renderMuted("Aborting..."));
      return;
    }

    setStatus(spinnerFrame ?? renderMuted("Transmogrifying"));
  }

  return {
    start() {
      active = true;
      aborting = false;
      spinner.start();
      syncStatus();
    },
    stop() {
      active = false;
      aborting = false;
      spinner.stop();
      spinnerFrame = null;
      setStatus(null);
    },
    showAborting() {
      active = true;
      aborting = true;
      spinner.start();
      syncStatus();
    },
    beginTextStreaming() {
      if (!active) {
        return;
      }
      aborting = false;
      syncStatus();
    },
    noteToolActivity() {
      if (!active) {
        return;
      }
      aborting = false;
      spinner.refresh();
      syncStatus();
    },
    noteReasoningPreview(_preview) {
      if (!active) {
        return;
      }
      aborting = false;
      syncStatus();
    },
  };
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
  let aborting = false;
  const activityStatus = createActivityStatusController(setStatus);
  const abortTurn = (): void => {
    if (aborting) {
      return;
    }
    aborting = true;
    void abortCurrentTurn(config).catch(() => {});
    activityStatus.showAborting();
  };
  const localTranscript = new TranscriptRenderer();
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
  const turnStartedAt = Date.now();
  let toolCallCount = 0;
  activityStatus.start();
  setToolActivityHook(() => {
    toolCallCount += 1;
    localTranscript.finish();
    activityStatus.noteToolActivity();
  });
  setReasoningActivityHook((payload) => {
    activityStatus.noteReasoningPreview(null);
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
        localTranscript.beginAssistantText();
        activityStatus.beginTextStreaming();
        receivedChunk = true;
        if (consumeToolActivity()) {
          writeOutput("\n");
        }
        localTranscript.render({ type: "assistant_text", content: chunk });
      },
      onEnd: () => {
        receivedEnd = true;
        if (aborting && !receivedChunk) {
          localTranscript.render({ type: "stream_error", message: "aborted", aborted: true });
          return;
        }
        if (!receivedChunk) {
          localTranscript.render({ type: "stream_end", fallback: "(no response)" });
          return;
        }
        localTranscript.render({ type: "stream_end" });
      },
      onError: (message) => {
        receivedEnd = true;
        if (aborting || /aborted/i.test(message)) {
          localTranscript.render({ type: "stream_error", message, aborted: true });
          return;
        }
        localTranscript.render({ type: "stream_error", message });
      },
    }, streamAbortController.signal);
    if (!receivedEnd && !aborting) {
      await abortCurrentTurn(config).catch(() => {});
      throw new Error("chat stream ended before the server sent an end event");
    }
  } catch (error) {
    localTranscript.finish();
    if (!receivedEnd && !aborting) {
      await abortCurrentTurn(config).catch(() => {});
    }
    const message = errorMessage(error);
    if (aborting || /aborted/i.test(message)) {
      localTranscript.render({ type: "stream_error", message, aborted: true });
      return;
    }
    localTranscript.render({ type: "stream_error", message });
  } finally {
    streamAbortController.abort();
    liveSync.endLocalTurn();
    localTranscript.finish();
    activityStatus.stop();
    if (toolCallCount > 1 && !aborting) {
      writeOutput(renderWorkedFor(Date.now() - turnStartedAt));
    }
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
  const activityStatus = createActivityStatusController((status) => {
    if (options.getLocalTurnActive()) {
      return;
    }
    if (!remoteTurnRunning && status !== null) {
      return;
    }
    options.promptReader.setStatus(status);
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
    if (Array.isArray(payload.steering_queue) && !options.getLocalTurnActive()) {
      options.promptReader.setQueuedDisplay(
        steeringQueueSubmissions({ items: payload.steering_queue }),
      );
    }

    if (remoteTurnRunning) {
      if (options.getLocalTurnActive()) {
        return;
      }
      activityStatus.start();
      if (!options.getActiveSteerHandler()) {
        options.setActiveSteerHandler(remoteSteerHandler);
      }
      options.promptReader.setAbortHandler(() => {
        void abortCurrentTurn(options.config()).catch(() => {});
        activityStatus.showAborting();
      });
      options.promptReader.setQueuedLinePopHandler(() => {
        void cancelLastSteering(options.config()).catch(() => {});
      });
      return;
    }

    activityStatus.stop();
    if (!options.getLocalTurnActive()) {
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
      activityStatus.noteReasoningPreview(null);
    });
    setToolActivityHook(() => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      activityStatus.noteToolActivity();
    });
  };

  const dispose = (): void => {
    activityStatus.stop();
    setTurnStatusHook(null);
    setReasoningActivityHook(null);
    setToolActivityHook(null);
  };

  const beforeAssistantText = (): void => {
    if (!remoteTurnRunning || options.getLocalTurnActive()) {
      return;
    }
    activityStatus.beginTextStreaming();
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
    shareManager: ShareManager;
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
      await updateGlobalAuth({ provider: status.provider, model: status.model });
      context.setFooter(renderFooter(config, status, context.shareManager.current()));
      context.setModelSuggestions(await loadModelSuggestions());
      writeOutput(`${renderMuted(`model set to ${status.provider}/${status.model}`)}\n`);
      break;
    }
    case "share": {
      const mode = (parsed.args[0] ?? "").toLowerCase();
      if (!mode || mode === "start") {
        const result = await context.shareManager.start(config);
        renderShareStatus(result.share, result.reused ? "share already active" : "share started");
        writeOutput(`${renderMuted("note: transport is live; Chump share auth is the next step")}\n`);
        context.setFooter(renderFooter(config, await getStatus(config), context.shareManager.current()));
        break;
      }
      if (mode === "status") {
        const share = context.shareManager.current();
        if (!share) {
          writeOutput(`${renderMuted("share is inactive")}\n`);
          break;
        }
        renderShareStatus(share, "share active");
        break;
      }
      if (mode === "stop") {
        const share = await context.shareManager.stop();
        if (!share) {
          writeOutput(`${renderMuted("share is inactive")}\n`);
          break;
        }
        writeOutput(`${renderMuted(`share stopped: ${share.publicUrl}`)}\n`);
        context.setFooter(renderFooter(config, await getStatus(config), context.shareManager.current()));
        break;
      }
      writeOutput(`${renderMuted("usage: /share [status|stop]")}\n`);
      break;
    }
    case "thinking": {
      const mode = parsed.args[0];
      if (!isThinkingMode(mode)) {
        writeOutput(`${renderMuted("usage: /thinking <none|low|high|xhigh>")}\n`);
        break;
      }
      const status = await setReasoning(config, mode);
      await updateGlobalAuth({ reasoning: { mode } });
      context.setFooter(renderFooter(config, status, context.shareManager.current()));
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
        await renderSwitchedSession(config, context.shareManager, context.setFooter, context.setSessionSuggestions, {
          skipEmptyTranscript: true,
        });
        context.setSkillSuggestions((await getHealth(config)).skills);
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      clearTerminal();
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      await renderSwitchedSession(config, context.shareManager, context.setFooter, context.setSessionSuggestions);
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
      await renderSwitchedSession(config, context.shareManager, context.setFooter, context.setSessionSuggestions);
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
  shareManager: ShareManager,
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
  setFooter(renderFooter(config, status, shareManager.current()));
  setSessionSuggestions(sessions.sessions);
  if (options.skipEmptyTranscript && response.messages.length === 0) {
    return;
  }
  renderSessionTranscript(response.messages);
}

function renderFooter(
  config: ChumpConfig,
  health: { provider: string; model: string; reasoning: Record<string, unknown> | null },
  share: ShareStatus | null,
): string {
  // Render each part in full; the input frame wraps the footer at the
  // terminal's width, so a long footer flows onto multiple lines instead of
  // being hard-truncated with an ellipsis.
  return renderFooterStatus([
    `${health.provider}/${health.model}`,
    renderReasoning(health.reasoning),
    share ? "shared" : "",
    config.serverSource,
    config.agentId,
  ]);
}

function renderShareStatus(share: ShareStatus, label: string): void {
  writeOutput(`${renderMuted(`${label}\n`)}`);
  writeOutput(`${renderAccent(`${share.publicUrl}\n`)}`);
  if (share.connectUrl) {
    writeOutput(`${renderMuted("web: ")}${renderAccent(`${share.connectUrl}\n`)}`);
  }
  writeOutput(`${renderMuted(`provider: ${share.provider}\n`)}`);
  writeOutput(`${renderMuted(`target: ${share.localUrl}\n`)}`);
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
