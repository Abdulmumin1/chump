import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  abortCurrentTurn,
  cancelLastSteering,
  clearMessages,
  getEventLog,
  compactMessages,
  getHealth,
  getMessages,
  getSessions,
  getState,
  getStatus,
  loadSkill,
  setModel,
  setReasoning,
  searchFiles,
  steerCurrentTurn,
  streamChat,
} from "../api/http.ts";
import { openEventStream } from "../api/sse.ts";
import {
  parseSlashCommand,
  printHelp,
  switchAgent,
} from "./commands.ts";
import { connectProvider, readGlobalAuth, updateGlobalAuth, PROVIDERS } from "./auth.ts";
import { logClientEvent } from "./diagnostics.ts";
import {
  getModelContextLabel,
  getModelContextLimit,
  listModelChoices,
} from "./models.ts";
import { ShareManager } from "./share.ts";
import { renderTerminalQr } from "./terminal-qr.ts";
import {
  createSessionId,
  loadConfig,
  renderBanner,
  resolveWorkspaceRoot,
  getResolvedConfig,
} from "./config.ts";
import {
  consumeToolActivity,
  setBeforeToolActivityHook,
  setAgentStatusHook,
  setAssistantTextHook,
  setCompactionStatusHook,
  setReasoningActivityHook,
  setSteeringAcceptedHook,
  setSteeringQueueHook,
  setToolActivityHook,
  setToolCallStreamHook,
  setToolResultHook,
  setTurnStatusHook,
  startEventStream,
} from "../ui/events.ts";
import { createPromptReader } from "../ui/input.ts";
import { createActivityStatusController } from "../ui/activity-status.ts";
import type { StatusDisplay } from "../ui/status.ts";
import {
  renderSessionTranscript,
  renderServerStatus,
  renderSessions,
} from "../ui/output.ts";
import {
  createMarkdownStream,
  renderAccent,
  renderError,
  renderMuted,
  renderUserMessage,
  renderWorkedFor,
} from "../ui/render.ts";
import { clearTerminal, writeOutput } from "../ui/terminal.ts";
import { ToolActivityRenderer } from "../ui/tool-activity.ts";
import { TranscriptRenderer } from "../ui/transcript.ts";
import {
  ensureServerTarget,
  parseCliArgs,
  printCliUsage,
  startServerCommand,
  stopManagedServer,
} from "./runtime.ts";
import {
  ManagedServerRequestCoordinator,
  recoverManagedServerUrl,
  type ServerRequestRunner,
} from "./managed-recovery.ts";
import {
  currentClientVersion,
  maybeRenderUpdateNotice,
  runUpdateCommand,
} from "./update.ts";
import {
  parseProjectCommand,
  projectCommandUsage,
  runProjectCommand,
} from "./project-command.ts";
import {
  daemonCommandUsage,
  parseDaemonCommand,
  runDaemonCommand,
} from "./daemon-command.ts";
import { parseAppCommand, runAppCommand } from "./app-command.ts";
import { renderSessionFooter } from "../ui/footer.ts";
import { isChumpEventType, parseChumpEvent } from "../core/events.ts";
import type {
  ChumpConfig,
  CliOptions,
  ManagedServerMetadata,
  PromptSubmission,
  ShareStatus,
  ChumpStatus,
  StoredEvent,
  SseEvent,
  UsageSummary,
} from "../core/types.ts";

async function runProvidersCommand(): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const resolved = getResolvedConfig(workspaceRoot);
  const auth = await readGlobalAuth();
  const credentials = auth.credentials ?? {};

  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const green = (s: string) => useColor ? `\x1b[32m${s}\x1b[0m` : s;
  const yellow = (s: string) => useColor ? `\x1b[33m${s}\x1b[0m` : s;
  const bold = (s: string) => useColor ? `\x1b[1m${s}\x1b[0m` : s;
  const dim = (s: string) => useColor ? `\x1b[2m${s}\x1b[0m` : s;

  console.log(bold("\nConnected Providers:\n"));

  for (const [id, def] of Object.entries(PROVIDERS)) {
    let status = "disconnected";
    let source = "";

    if (id === "chump_cloud") {
      status = "connected";
      source = "default cloud (no credentials required)";
    } else {
      const hasAuthCreds = credentials[id] && Object.keys(credentials[id]).length > 0;
      if (hasAuthCreds) {
        status = "connected";
        source = "saved credentials";
      }

      const requiredFields = def.fields.filter((f) => !("optional" in f && f.optional === true));
      if (requiredFields.length > 0) {
        const hasEnvCreds = requiredFields.every((f) => process.env[f.key]);
        if (hasEnvCreds) {
          status = "connected";
          source = source ? `${source} & environment variables` : "environment variables";
        }
      }
    }

    const isActive = id === resolved.provider;
    const prefix = isActive ? "● " : "  ";
    const statusLabel = status === "connected" ? green("connected") : dim("not connected");
    const sourceLabel = source ? ` (${dim(`via ${source}`)})` : "";
    const activeLabel = isActive ? ` ${yellow("(active)")}` : "";

    console.log(`${prefix}${bold(def.label)} (${id})`);
    console.log(`  Status: ${statusLabel}${sourceLabel}${activeLabel}`);
    if (def.defaultModel) {
      console.log(`  Default Model: ${dim(def.defaultModel)}`);
    }
    console.log("");
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "app") {
    if (argv[1] === "--help" || argv[1] === "-h") {
      console.log("chump app [--web-url <url>] [--no-open] [--json]");
      return;
    }
    console.log(await runAppCommand(parseAppCommand(argv.slice(1))));
    return;
  }

  if (argv[0] === "daemon") {
    if (argv[1] === "--help" || argv[1] === "-h") {
      console.log(daemonCommandUsage());
      return;
    }
    console.log(await runDaemonCommand(parseDaemonCommand(argv.slice(1))));
    return;
  }

  if (argv[0] === "projects") {
    if (argv[1] === "--help" || argv[1] === "-h") {
      console.log(projectCommandUsage());
      return;
    }
    console.log(
      await runProjectCommand(
        parseProjectCommand(argv.slice(1), process.cwd()),
      ),
    );
    return;
  }

  const options = parseCliArgs(argv);
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());

  if (options.mode === "help") {
    printCliUsage();
    return;
  }

  if (options.mode === "version") {
    console.log(currentClientVersion());
    return;
  }

  if (options.mode === "update") {
    await runUpdateCommand();
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

  if (options.mode === "providers") {
    await runProvidersCommand();
    return;
  }

  if (options.mode === "server") {
    const result = await startServerCommand(workspaceRoot);
    if (!result.started) {
      console.log(`server already running at ${result.metadata.url}`);
    }
    return;
  }

  if (options.mode === "print") {
    await runPrintPrompt(workspaceRoot, options);
    return;
  }

  // Refresh on every interactive launch so a recently published release is
  // not hidden by yesterday's "up to date" cache entry. Start the request
  // while the managed server initializes so it does not delay the UI.
  const updateNoticePromise = maybeRenderUpdateNotice({ refresh: true });
  const target = await ensureServerTarget(workspaceRoot, options);
  let config = loadConfig({
    agentId: options.sessionId ?? undefined,
    serverUrl: target.serverUrl,
    serverSource: target.serverSource,
  });
  const standaloneRequest = createStandaloneServerRequestRunner(config);

  if (options.mode === "status") {
    const [health, status] = await standaloneRequest(
      config,
      (requestConfig) => Promise.all([
        getHealth(requestConfig),
        getStatus(requestConfig),
      ]),
    );
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
  let localCompactionActive = false;
  let lastServerEventId = 0;

  const statusValues = new Map<string, StatusDisplay>();
  const setCoordinatedStatus = (source: string, statusText: StatusDisplay) => {
    statusValues.set(source, statusText);
    const compaction = statusValues.get("compaction");
    if (compaction) {
      promptReader.setStatus(compaction);
      return;
    }
    const turn = statusValues.get("turn");
    if (turn) {
      promptReader.setStatus(turn);
      return;
    }
    promptReader.setStatus(null);
  };

  const [health, status, sessions] = await standaloneRequest(
    config,
    (requestConfig) => Promise.all([
      getHealth(requestConfig),
      getStatus(requestConfig),
      getSessions(requestConfig),
    ]),
  );
  promptReader.setFooter(renderSessionFooter(config, status, shareManager.current()));
  promptReader.setRuleBadge(await renderInputBadge(status));
  promptReader.setSessionSuggestions(sessions.sessions);
  promptReader.setModelSuggestions(
    await loadModelSuggestions(health.available_models),
  );
  promptReader.setSkillSuggestions(health.skills);
  promptReader.setAbortHandler(null);
  promptReader.setQueuedLinePopHandler(() => {
    lineQueue.popLast();
  });
  setAgentStatusHook((payload) => {
    const status = payload as {
      provider: string;
      model: string;
      reasoning: Record<string, unknown> | null;
      git_branch?: string;
      usage?: UsageSummary | null;
    };
    promptReader.setFooter(renderSessionFooter(config, status, shareManager.current()));
    void renderInputBadge(status).then((badge) => {
      promptReader.setRuleBadge(badge);
    });
  });
  setSteeringQueueHook((payload) => {
    // Server is the source of truth for the steering queue. Apply its
    // updates unconditionally — previously this was gated to "not during
    // local turn" to avoid conflicting with a local-side push, which no
    // longer exists.
    promptReader.setQueuedDisplay(steeringQueueSubmissions(payload));
  });
  const compactionStatus = createActivityStatusController(
    (status) => setCoordinatedStatus("compaction", status),
    { label: "Compacting" },
  );
  setCompactionStatusHook((payload) => {
    if (localCompactionActive) {
      return;
    }
    if (payload.running === true) {
      compactionStatus.start();
      return;
    }
    compactionStatus.stop();
  });
  const refreshCliHydration = async (): Promise<void> => {
    const [health, status, sessions] = await Promise.all([
      getHealth(config),
      getStatus(config),
      getSessions(config),
    ]);
    promptReader.setFooter(renderSessionFooter(config, status, shareManager.current()));
    promptReader.setRuleBadge(await renderInputBadge(status));
    promptReader.setSessionSuggestions(sessions.sessions);
    promptReader.setModelSuggestions(
      await loadModelSuggestions(health.available_models),
    );
    promptReader.setSkillSuggestions(health.skills);
    promptReader.setQueuedDisplay(steeringQueueSubmissions({ items: status.steering_queue ?? [] }));
    sharedTurnSync.applyTurnStatus({
      running: status.turn_running === true,
      steering_queue: status.steering_queue ?? [],
    });
  };

  const recoverManagedServerSession = async (): Promise<void> => {
    if (config.serverSource !== "managed") {
      throw new Error("managed server recovery is unavailable for direct connections");
    }
    const recoveredUrl = await recoverManagedServerUrl(
      config.workspaceRoot,
      config.serverUrl,
    );
    config.serverUrl = recoveredUrl;
    config.serverSource = "managed";
    closeEventStream?.();
    closeEventStream = await startRecoverableEventStream(config);
    await refreshCliHydration();
  };

  const requestCoordinator = new ManagedServerRequestCoordinator(
    () => config,
    recoverManagedServerSession,
  );
  const runServerRequest: ServerRequestRunner = (requestConfig, request, requestOptions) =>
    requestCoordinator.run(requestConfig, request, requestOptions);

  const startRecoverableEventStream = async (
    streamConfig: ChumpConfig,
  ): Promise<(() => void) | null> => {
    const currentStreamConfig = {
      ...streamConfig,
      serverUrl: config.serverUrl,
      serverSource: config.serverSource,
    };
    return await startEventStream(currentStreamConfig, {
      lastEventId: lastServerEventId,
      onLastEventId: (eventId) => {
        lastServerEventId = eventId;
      },
      onConnectionError: async (error) => {
        await requestCoordinator.recoverFromDisconnect(error);
      },
    });
  };
  promptReader.setFileSearch((query) =>
    runServerRequest(config, (requestConfig) => searchFiles(requestConfig, query, 20))
  );

  const sharedTurnSync = createSharedTurnSync({
    config: () => config,
    promptReader,
    setStatus: (status) => setCoordinatedStatus("turn", status),
    runServerRequest,
    getLocalTurnActive: () => liveSync.hasLocalTurn(),
    getActiveSteerHandler: () => activeSteerHandler,
    setActiveSteerHandler: (handler) => {
      activeSteerHandler = handler;
    },
    popQueuedLine: () => lineQueue.popLast(),
    removeQueuedDisplay: (content) => promptReader.removeQueuedDisplay(content),
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
    writeOutput(`[server] ${target.note}\n`);
  }
  writeOutput(`${renderBanner(config, { workspaceRoot: health.workspace_root })}\n`);
  const updateNotice = await updateNoticePromise;
  if (updateNotice) {
    writeOutput(`${renderMuted(updateNotice)}\n`);
  }
  renderLoadedResources(health, config.workspaceRoot);
  closeEventStream = await startRecoverableEventStream(config);
  if (options.sessionId) {
    const switchedStatus = await renderSwitchedSession(
      config,
      shareManager,
      (footer) => promptReader.setFooter(footer),
      (badge) => promptReader.setRuleBadge(badge),
      (sessionsList) => {
      promptReader.setSessionSuggestions(sessionsList);
      },
      runServerRequest,
      {
        skipEmptyTranscript: true,
      },
    );
    sharedTurnSync.applyTurnStatus({
      running: switchedStatus.turn_running === true,
      steering_queue: switchedStatus.steering_queue ?? [],
    });
    promptReader.setSkillSuggestions((await runServerRequest(
      config,
      getHealth,
    )).skills);
  }

  void readInputLoop(
    promptReader,
    lineQueue,
    () => activeSteerHandler,
    async (line) => {
      if (!isImmediateActiveSlashCommand(line.text)) {
        return false;
      }
      const commandResult = await handleSlashCommand(line.text, {
        config,
        closeEventStream,
        shareManager,
        metadata: target.metadata,
        setFooter: (footer) => promptReader.setFooter(footer),
        setStatus: (statusText) => setCoordinatedStatus("turn", statusText),
        setLocalCompactionActive: (active) => {
          localCompactionActive = active;
        },
        setRuleBadge: (badge) => promptReader.setRuleBadge(badge),
        setSessionSuggestions: (sessionsList) => promptReader.setSessionSuggestions(sessionsList),
        setModelSuggestions: (models) => promptReader.setModelSuggestions(models),
        setSkillSuggestions: (skills) => promptReader.setSkillSuggestions(skills),
        setRemoteTurnStatus: (payload) => sharedTurnSync.applyTurnStatus(payload),
        runServerRequest,
        restartEventStream: async (nextConfig) => {
          closeEventStream?.();
          if (nextConfig.agentId !== config.agentId) {
            lastServerEventId = 0;
          }
          closeEventStream = await startRecoverableEventStream(nextConfig);
          return closeEventStream;
        },
      });
      if (
        commandResult &&
        commandResult !== "quit" &&
        commandResult.submission
      ) {
        return await (activeSteerHandler?.(commandResult.submission) ?? false);
      }
      return true;
    },
  );

  try {
    while (true) {
      const nextLine = await lineQueue.shift();
      if (nextLine === null) {
        resumeSessionId = config.agentId;
        break;
      }

      const line = nextLine.text;
      if (!line.trim() && nextLine.attachments.length === 0) {
        continue;
      }
      const parsedSlashCommand = parseSlashCommand(line);
      if (parsedSlashCommand && parsedSlashCommand.command !== "skill") {
        writeOutput(`${renderUserMessage(line)}\n`);
      }

      const commandResult = await handleSlashCommand(line, {
        config,
        closeEventStream,
        shareManager,
        metadata: target.metadata,
        setFooter: (footer) => promptReader.setFooter(footer),
        setStatus: (statusText) => setCoordinatedStatus("turn", statusText),
        setLocalCompactionActive: (active) => {
          localCompactionActive = active;
        },
        setRuleBadge: (badge) => promptReader.setRuleBadge(badge),
        setSessionSuggestions: (sessionsList) => promptReader.setSessionSuggestions(sessionsList),
        setModelSuggestions: (models) => promptReader.setModelSuggestions(models),
        setSkillSuggestions: (skills) => promptReader.setSkillSuggestions(skills),
        setRemoteTurnStatus: (payload) => sharedTurnSync.applyTurnStatus(payload),
        runServerRequest,
        restartEventStream: async (nextConfig) => {
          closeEventStream?.();
          if (nextConfig.agentId !== config.agentId) {
            lastServerEventId = 0;
          }
          closeEventStream = await startRecoverableEventStream(nextConfig);
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
            runServerRequest,
            (status) => setCoordinatedStatus("turn", status),
            (handler) => promptReader.setAbortHandler(handler),
            (handler) => {
              activeSteerHandler = handler;
            },
            (content) => promptReader.removeQueuedDisplay(content),
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
        runServerRequest,
        (status) => setCoordinatedStatus("turn", status),
        (handler) => promptReader.setAbortHandler(handler),
        (handler) => {
          activeSteerHandler = handler;
        },
        (content) => promptReader.removeQueuedDisplay(content),
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
    setAssistantTextHook(null);
    setAgentStatusHook(null);
    setCompactionStatusHook(null);
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

async function runPrintPrompt(
  workspaceRoot: string,
  options: CliOptions,
): Promise<void> {
  const pipedInput = await readPipedStdin();
  const message = buildPrintPrompt(pipedInput, options.printPrompt);
  if (!message.trim()) {
    throw new Error("missing prompt for -p/--print");
  }

  const target = await ensureServerTarget(workspaceRoot, options);
  const config = loadConfig({
    agentId: options.sessionId ?? undefined,
    serverUrl: target.serverUrl,
    serverSource: target.serverSource,
  });
  const runServerRequest = createStandaloneServerRequestRunner(config);

  const startedAt = Date.now();
  if (options.verbose) {
    writeVerbosePrintLine(`server: ${config.serverUrl} (${config.serverSource})`);
    writeVerbosePrintLine(`session: ${config.agentId}`);
    if (target.note) {
      writeVerbosePrintLine(target.note);
    }
    writeVerbosePrintLine(`prompt: ${message.length} chars`);
  }

  const hasEnvModel = process.env.CHUMP_MODEL || process.env.CHUMP_PROVIDER;
  const modelSelector = options.model || (hasEnvModel ? null : "chump_cloud/deepseek-v4-flash");

  if (modelSelector) {
    const [provider, modelName] = parseModelSelector(modelSelector);
    if (!provider || !modelName) {
      throw new Error("model must be in '<provider>/<model>' format (e.g., 'anthropic/claude-3-5-sonnet')");
    }
    if (options.verbose) {
      writeVerbosePrintLine(`setting model to ${provider}/${modelName}...`);
    }
    await runServerRequest(config, (requestConfig) =>
      setModel(requestConfig, provider, modelName)
    );
  }

  if (options.thinking) {
    if (options.verbose) {
      writeVerbosePrintLine(`setting thinking to ${options.thinking}...`);
    }
    await runServerRequest(config, (requestConfig) =>
      setReasoning(requestConfig, options.thinking!)
    );
  }

  let receivedChunk = false;
  let receivedEnd = false;
  let streamError: string | null = null;
  let lastOutputChar = "";
  const verboseEvents = options.verbose ? await createPrintVerboseEventLogger(config) : null;
  const responseRenderer = createPrintResponseRenderer();

  try {
    await runServerRequest(config, (requestConfig) => streamChat(requestConfig, message, [], {
      onChunk: (chunk) => {
        receivedChunk = true;
        if (chunk) {
          responseRenderer.write(chunk);
          lastOutputChar = chunk.at(-1) ?? lastOutputChar;
        }
      },
      onEnd: (finalText) => {
        receivedEnd = true;
        if (!receivedChunk && finalText) {
          responseRenderer.write(finalText);
          lastOutputChar = finalText.at(-1) ?? lastOutputChar;
        }
      },
      onError: (messageText) => {
        receivedEnd = true;
        streamError = messageText;
      },
    }), {
      canReplay: () => !receivedChunk && !receivedEnd,
    });
  } catch (error) {
    if (!receivedEnd) {
      await runServerRequest(config, abortCurrentTurn).catch(() => {});
    }
    throw error;
  } finally {
    responseRenderer.end();
    await verboseEvents?.replayMissed();
    verboseEvents?.close();
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!receivedEnd) {
    await runServerRequest(config, abortCurrentTurn).catch(() => {});
    throw new Error("chat stream ended before the server sent an end event");
  }
  if (!responseRenderer.handlesTrailingNewline && lastOutputChar && lastOutputChar !== "\n") {
    process.stdout.write("\n");
  }

  if (options.verbose) {
    writeVerbosePrintLine(`done: ${Date.now() - startedAt}ms`);
  }
}

function createStandaloneServerRequestRunner(config: ChumpConfig): ServerRequestRunner {
  const coordinator = new ManagedServerRequestCoordinator(
    () => config,
    async () => {
      config.serverUrl = await recoverManagedServerUrl(
        config.workspaceRoot,
        config.serverUrl,
      );
    },
  );
  return (requestConfig, request, options) =>
    coordinator.run(requestConfig, request, options);
}

async function readPipedStdin(): Promise<string | null> {
  if (input.isTTY) {
    return null;
  }

  let content = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    content += String(chunk);
  }
  return content;
}

function buildPrintPrompt(pipedInput: string | null, prompt: string | null): string {
  const parts: string[] = [];
  const normalizedInput = pipedInput?.trimEnd() ?? "";
  const normalizedPrompt = prompt?.trim() ?? "";
  if (normalizedInput) {
    parts.push(normalizedInput);
  }
  if (normalizedPrompt) {
    parts.push(normalizedPrompt);
  }
  return parts.join("\n\n");
}

function writeVerbosePrintLine(message: string): void {
  process.stderr.write(`[chump] ${message}\n`);
}

function createPrintResponseRenderer(): {
  write: (chunk: string) => void;
  end: () => void;
  handlesTrailingNewline: boolean;
} {
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    return {
      write(chunk: string) {
        process.stdout.write(chunk);
      },
      end() {},
      handlesTrailingNewline: false,
    };
  }

  const stream = createMarkdownStream((value) => process.stdout.write(value));
  return {
    write(chunk: string) {
      stream.write(chunk);
    },
    end() {
      stream.end();
    },
    handlesTrailingNewline: true,
  };
}

async function createPrintVerboseEventLogger(config: ChumpConfig): Promise<{
  close: () => void;
  replayMissed: () => Promise<void>;
}> {
  const renderer = new ToolActivityRenderer((value = "") => {
    process.stderr.write(`${value}\n`);
  });
  const renderedEventIds = new Set<number>();
  const eventLog = await getEventLog(config).catch(() => ({ events: [] }));
  const baselineEventId = Math.max(0, ...eventLog.events.map((event) => event.id));

  const renderEvent = (event: StoredEvent): void => {
    if (event.id <= baselineEventId || renderedEventIds.has(event.id)) {
      return;
    }
    const chumpEvent = parseChumpEvent(event.type, event.data);
    if (isChumpEventType(event.type) && !chumpEvent) {
      return;
    }
    if (
      renderVerboseToolEvent(
        event.type,
        chumpEvent?.data ?? event.data,
        renderer,
      )
    ) {
      renderedEventIds.add(event.id);
    }
  };

  const close = await openEventStream(
    config,
    {
      onEvent: (event) => {
        const parsed = storedEventFromSse(event);
        if (parsed) {
          renderEvent(parsed);
        }
      },
      onError: (error) => {
        writeVerbosePrintLine(`events: ${error.message}`);
      },
    },
    {
      lastEventId: baselineEventId,
      reconnectDelayMs: 250,
      maxReconnectDelayMs: 2_000,
    },
  );

  return {
    close,
    replayMissed: async () => {
      const latest = await getEventLog(config).catch(() => ({ events: [] }));
      for (const event of latest.events) {
        renderEvent(event);
      }
    },
  };
}

function storedEventFromSse(event: SseEvent): StoredEvent | null {
  const id = Number(event.id);
  if (!Number.isFinite(id)) {
    return null;
  }
  const data = parseSseData(event.data);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const chumpEvent = parseChumpEvent(event.event, data);
  if (isChumpEventType(event.event) && !chumpEvent) {
    return null;
  }
  return {
    id,
    type: event.event,
    data: chumpEvent?.data ?? data as Record<string, unknown>,
  };
}

function parseSseData(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function renderVerboseToolEvent(
  type: string,
  payload: Record<string, unknown>,
  renderer: ToolActivityRenderer,
): boolean {
  if (type === "tool_call") {
    renderer.renderToolCall(payload);
    return true;
  }
  if (type === "tool_result") {
    renderer.renderToolResult(payload);
    return true;
  }
  if (type === "tool_execution.finished") {
    renderer.renderToolResult(payload);
    return true;
  }
  return false;
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
  runServerRequest: ServerRequestRunner,
  setStatus: (status: StatusDisplay) => void,
  setAbortHandler: (handler: (() => void) | null) => void,
  setSteerHandler: (handler: ((submission: PromptSubmission) => Promise<boolean>) | null) => void,
  popSteeredDisplay: (content: string) => void,
  setQueuedLinePopHandler: (handler: (() => void) | null) => void,
  requeueSteeredSubmission: (submission: PromptSubmission) => void,
): Promise<void> {
  const streamAbortController = new AbortController();
  liveSync.beginLocalTurn();
  let aborting = false;
  const activityStatus = createActivityStatusController(setStatus);
  const abortTurn = (): void => {
    if (aborting) {
      return;
    }
    aborting = true;
    void runServerRequest(config, abortCurrentTurn).catch(() => {});
    activityStatus.showAborting();
  };
  const localTranscript = new TranscriptRenderer();
  const pendingSteeringSubmissions: PromptSubmission[] = [];
  const popPendingSteeringSubmission = (): void => {
    const pending = pendingSteeringSubmissions.pop() ?? null;
    if (!pending) {
      return;
    }
    void runServerRequest(config, cancelLastSteering).catch(() => {});
  };
  setAbortHandler(abortTurn);
  setQueuedLinePopHandler(popPendingSteeringSubmission);
  setSteeringAcceptedHook((content) => {
    removePendingSteeringSubmission(content);
    popSteeredDisplay(content);
  });
  setSteerHandler(async (nextSubmission) => {
    const result = await runServerRequest(config, (requestConfig) =>
      steerCurrentTurn(
        requestConfig,
        nextSubmission.text,
        nextSubmission.attachments,
        nextSubmission.displayText,
      )
    );
    if (result.status !== "steered") {
      return false;
    }
    pendingSteeringSubmissions.push(nextSubmission);
    return true;
  });
  const turnStartedAt = Date.now();
  let toolCallCount = 0;
  activityStatus.start();
  setBeforeToolActivityHook(() => {
    // Assistant chunks can still be buffered while waiting for a newline.
    // Flush them before the event stream prints the following tool row.
    localTranscript.finish();
  });
  setToolActivityHook((preview, payload) => {
    toolCallCount += 1;
    activityStatus.noteToolActivity(preview, payload);
  });
  setToolCallStreamHook((preview, payload) => {
    activityStatus.noteToolCallPreview(preview, payload);
  });
  setToolResultHook((payload) => {
    activityStatus.noteToolResult(payload);
  });
  setReasoningActivityHook((payload) => {
    activityStatus.noteReasoningActivity(payload);
  });
  let receivedChunk = false;
  let receivedEnd = false;

  try {
    logClientEvent(
      "chatSubmit",
      `chars=${submission.text.length} attachments=${submission.attachments.length}`,
    );
    await runServerRequest(
      config,
      (requestConfig) => streamChat(requestConfig, submission.text, submission.attachments, {
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
      }, streamAbortController.signal, submission.displayText),
      {
        canReplay: () =>
          !receivedChunk && !receivedEnd && toolCallCount === 0,
      },
    );
    if (!receivedEnd && !aborting) {
      await runServerRequest(config, abortCurrentTurn).catch(() => {});
      throw new Error("chat stream ended before the server sent an end event");
    }
  } catch (error) {
    localTranscript.finish();
    if (!receivedEnd && !aborting) {
      await runServerRequest(config, abortCurrentTurn).catch(() => {});
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
    setBeforeToolActivityHook(null);
    setToolActivityHook(null);
    setToolCallStreamHook(null);
    setToolResultHook(null);
    setReasoningActivityHook(null);
  }

  function removePendingSteeringSubmission(content: string): void {
    const index = pendingSteeringSubmissions.findIndex(
      (item) => (item.displayText ?? item.text) === content,
    );
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

class LiveSyncTracker {
  private localTurnCount = 0;

  beginLocalTurn(): void {
    this.localTurnCount += 1;
  }

  endLocalTurn(): void {
    this.localTurnCount = Math.max(0, this.localTurnCount - 1);
  }

  hasLocalTurn(): boolean {
    return this.localTurnCount > 0;
  }

  suppressAssistantText(): boolean {
    return this.localTurnCount > 0;
  }
}

function createSharedTurnSync(options: {
  config: () => ChumpConfig;
  promptReader: ReturnType<typeof createPromptReader>;
  setStatus: (status: StatusDisplay) => void;
  runServerRequest: ServerRequestRunner;
  getLocalTurnActive: () => boolean;
  getActiveSteerHandler: () => ((submission: PromptSubmission) => Promise<boolean>) | null;
  setActiveSteerHandler: (handler: ((submission: PromptSubmission) => Promise<boolean>) | null) => void;
  popQueuedLine: () => PromptSubmission | null;
  removeQueuedDisplay: (content: string) => void;
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
    options.setStatus(status);
  });
  const remoteSteerHandler = async (submission: PromptSubmission): Promise<boolean> => {
    const baseConfig = options.config();
    const result = await options.runServerRequest(baseConfig, (requestConfig) =>
      steerCurrentTurn(
        requestConfig,
        submission.text,
        submission.attachments,
        submission.displayText,
      )
    );
    if (result.status !== "steered") {
      return false;
    }
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
    setSteeringAcceptedHook((content) => {
      options.removeQueuedDisplay(content);
    });
    setReasoningActivityHook((payload) => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      activityStatus.noteReasoningActivity(payload);
    });
    setToolActivityHook((preview, payload) => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      activityStatus.noteToolActivity(preview, payload);
    });
    setToolCallStreamHook((preview, payload) => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      activityStatus.noteToolCallPreview(preview, payload);
    });
    setToolResultHook((payload) => {
      if (!remoteTurnRunning || options.getLocalTurnActive()) {
        return;
      }
      activityStatus.noteToolResult(payload);
    });
  };

  const dispose = (): void => {
    activityStatus.stop();
    setTurnStatusHook(null);
    setSteeringAcceptedHook(null);
    setReasoningActivityHook(null);
    setToolActivityHook(null);
    setToolCallStreamHook(null);
    setToolResultHook(null);
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
  handleActiveSlashCommand: ((submission: PromptSubmission) => Promise<boolean>) | null,
): Promise<void> {
  try {
    while (true) {
      const line = await promptReader.read();
      if (line === null) {
        lineQueue.close();
        return;
      }
      const steerHandler = getSteerHandler();
      if (steerHandler && handleActiveSlashCommand) {
        const handled = await handleActiveSlashCommand(line).catch(() => false);
        if (handled) {
          continue;
        }
      }
      if (steerHandler && shouldSteer(line)) {
        // Server is the source of truth for the steering queue. We do NOT
        // push locally here — the server broadcasts a steering_queue event
        // on acceptance which updates the display via setQueuedDisplay.
        // Pushing locally AND letting the server echo produced a visible
        // "queue item rendered twice" effect.
        const steered = await steerHandler(line).catch(() => false);
        if (steered) {
          continue;
        }
      }
      if (steerHandler && isBlockedActiveSlashCommand(line.text)) {
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
    "/compact",
    "/agent",
  ]).has(command);
}

function isImmediateActiveSlashCommand(value: string): boolean {
  const command = value.trimStart().split(/\s+/, 1)[0] ?? "";
  return command.startsWith("/skill:") || new Set(["/share", "/status"]).has(command);
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
    setStatus: (status: StatusDisplay) => void;
    setLocalCompactionActive: (active: boolean) => void;
    setRuleBadge: (badge: string | null) => void;
    setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void;
    setModelSuggestions: (models: Awaited<ReturnType<typeof loadModelSuggestions>>) => void;
    setSkillSuggestions: (skills: Awaited<ReturnType<typeof getHealth>>["skills"]) => void;
    setRemoteTurnStatus: (payload: Record<string, unknown>) => void;
    runServerRequest: ServerRequestRunner;
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
  const request = <T>(task: (requestConfig: ChumpConfig) => Promise<T>) =>
    context.runServerRequest(config, task);

  switch (parsed.command) {
    case "help":
      printHelp();
      break;
    case "status": {
      const [status, state] = await request((requestConfig) => Promise.all([
        getStatus(requestConfig),
        getState(requestConfig),
      ]));
      writeOutput(`${renderSessionStatusSummary(config, status, state)}\n`);
      break;
    }
    case "sessions": {
      const response = await request(getSessions);
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
      const status = await request((requestConfig) =>
        setModel(requestConfig, provider, model)
      );
      await updateGlobalAuth({ provider: status.provider, model: status.model });
      context.setFooter(renderSessionFooter(config, status, context.shareManager.current()));
      context.setRuleBadge(await renderInputBadge(status));
      const health = await request(getHealth);
      context.setModelSuggestions(
        await loadModelSuggestions(health.available_models),
      );
      writeOutput(`${renderMuted(`model set to ${status.provider}/${status.model}`)}\n`);
      break;
    }
    case "share": {
      const mode = (parsed.args[0] ?? "").toLowerCase();
      if (!mode || mode === "start") {
        const result = await context.shareManager.start(config);
        renderShareStatus(result.share, result.reused ? "share already active" : "share started");
        writeOutput(`${renderMuted("note: transport is live; Chump share auth is the next step")}\n`);
        context.setFooter(renderSessionFooter(config, await request(getStatus), context.shareManager.current()));
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
        context.setFooter(renderSessionFooter(config, await request(getStatus), context.shareManager.current()));
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
      const status = await request((requestConfig) =>
        setReasoning(requestConfig, mode)
      );
      await updateGlobalAuth({ reasoning: { mode } });
      context.setFooter(renderSessionFooter(config, status, context.shareManager.current()));
      context.setRuleBadge(await renderInputBadge(status));
      writeOutput(`${renderMuted(`thinking set to ${mode}`)}\n`);
      break;
    }
    case "clear": {
      const result = await request(clearMessages);
      writeOutput(`${JSON.stringify(result, null, 2)}\n`);
      break;
    }
    case "compact": {
      const activityStatus = createActivityStatusController(context.setStatus, { label: "Compacting" });
      context.setLocalCompactionActive(true);
      activityStatus.start();
      try {
        const result = await request(compactMessages);
        if (result.status === "ok") {
          writeOutput(
            `${renderMuted(
              `compacted ${result.messages_before ?? "?"} -> ${result.messages_after ?? "?"} messages`,
            )}\n`,
          );
        } else {
          writeOutput(`${renderMuted(`compaction skipped: ${result.reason ?? result.status}`)}\n`);
        }
      } finally {
        activityStatus.stop();
        context.setLocalCompactionActive(false);
      }
      context.setFooter(renderSessionFooter(config, await request(getStatus), context.shareManager.current()));
      break;
    }
    case "skill": {
      const name = parsed.args[0];
      if (!name) {
        writeOutput(`${renderMuted("usage: /skill:<name> [args]")}\n`);
        break;
      }
      const args = parsed.args.slice(1).join(" ").trim();
      const loaded = await request((requestConfig) =>
        loadSkill(requestConfig, name, args)
      );
      const displayText = `/skill:${loaded.name}${args ? ` ${args}` : ""}`;
      return {
        config,
        closeEventStream,
        submission: {
          text: loaded.prompt,
          displayText,
          attachments: [],
        },
      };
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
        const currentStatus = await request(getStatus);
        clearTerminal();
        writeOutput(`${renderBanner(config, { workspaceRoot: currentStatus.workspace_root })}\n`);
        const switchedStatus = await renderSwitchedSession(
          config,
          context.shareManager,
          context.setFooter,
          context.setRuleBadge,
          context.setSessionSuggestions,
          context.runServerRequest,
          {
            skipEmptyTranscript: true,
          },
        );
        context.setRemoteTurnStatus({
          running: switchedStatus.turn_running === true,
          steering_queue: switchedStatus.steering_queue ?? [],
        });
        context.setSkillSuggestions((await request(getHealth)).skills);
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      clearTerminal();
      writeOutput(`${renderMuted(`switched session to ${config.agentId}`)}\n`);
      const switchedStatus = await renderSwitchedSession(
        config,
        context.shareManager,
        context.setFooter,
        context.setRuleBadge,
        context.setSessionSuggestions,
        context.runServerRequest,
      );
      context.setRemoteTurnStatus({
        running: switchedStatus.turn_running === true,
        steering_queue: switchedStatus.steering_queue ?? [],
      });
      const health = await request(getHealth);
      context.setSkillSuggestions(health.skills);
      context.setModelSuggestions(
        await loadModelSuggestions(health.available_models),
      );
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
      const switchedStatus = await renderSwitchedSession(
        config,
        context.shareManager,
        context.setFooter,
        context.setRuleBadge,
        context.setSessionSuggestions,
        context.runServerRequest,
      );
      context.setRemoteTurnStatus({
        running: switchedStatus.turn_running === true,
        steering_queue: switchedStatus.steering_queue ?? [],
      });
      context.setSkillSuggestions((await request(getHealth)).skills);
      break;
    }
    case "quit":
      return "quit";
  }

  return { config, closeEventStream };
}

async function loadModelSuggestions(
  availableModels?: Record<string, readonly string[]>,
): Promise<Awaited<ReturnType<typeof listModelChoices>>> {
  const auth = await readGlobalAuth();
  const providers = Array.from(
    new Set(["chump_cloud", ...Object.keys(auth.credentials ?? {})]),
  );
  return await listModelChoices(providers, availableModels);
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
  setRuleBadge: (badge: string | null) => void,
  setSessionSuggestions: (sessions: Awaited<ReturnType<typeof getSessions>>["sessions"]) => void,
  runServerRequest: ServerRequestRunner,
  options: { skipEmptyTranscript?: boolean } = {},
): Promise<Awaited<ReturnType<typeof getStatus>>> {
  const [health, status, response, sessions] = await runServerRequest(
    config,
    (requestConfig) => Promise.all([
      getHealth(requestConfig),
      getStatus(requestConfig),
      getMessages(requestConfig),
      getSessions(requestConfig),
    ]),
  );
  setFooter(renderSessionFooter(config, status, shareManager.current()));
  setRuleBadge(await renderInputBadge(status));
  setSessionSuggestions(sessions.sessions);
  if (options.skipEmptyTranscript && response.messages.length === 0) {
    return status;
  }
  renderSessionTranscript(response.messages);
  return status;
}

async function renderInputBadge(
  health: {
    provider: string;
    model: string;
    turn_running?: boolean;
    usage?: UsageSummary | null;
  },
): Promise<string | null> {
  const limit = await getModelContextLimit(health.provider, health.model);
  const latestContext = latestContextTokens(health.usage);
  if (limit && latestContext !== null && latestContext >= 0) {
    return `ctx ${formatCompactNumber(Math.min(latestContext, limit))} / ${formatCompactNumber(limit)}`;
  }
  if (limit) {
    return `ctx ${formatCompactNumber(limit)}`;
  }
  if (latestContext !== null && latestContext > 0) {
    return `ctx ${formatCompactNumber(latestContext)}`;
  }
  return await getModelContextLabel(health.provider, health.model);
}

function latestContextTokens(usage: UsageSummary | null | undefined): number | null {
  const lastStepTotal = usage?.last_step?.total_tokens ?? null;
  if (lastStepTotal && lastStepTotal > 0) {
    return lastStepTotal;
  }
  return null;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function renderShareStatus(share: ShareStatus, label: string): void {
  writeOutput(`${renderMuted(`${label}\n`)}`);
  writeOutput(`${renderAccent(`${share.publicUrl}\n`)}`);
  if (share.connectUrl) {
    writeOutput(`${renderMuted("web: ")}${renderAccent(`${share.connectUrl}\n`)}`);
    writeOutput(`${renderMuted("scan:\n")}${renderTerminalQr(share.connectUrl)}\n`);
  }
  writeOutput(`${renderMuted(`provider: ${share.provider}\n`)}`);
  writeOutput(`${renderMuted(`target: ${share.localUrl}\n`)}`);
}

function renderSessionStatusSummary(
  config: ChumpConfig,
  status: ChumpStatus,
  state: import("../core/types.ts").ChumpState,
): string {
  const rows: Array<[label: string, value: string]> = [
    ["server", config.serverUrl],
    ["session", config.agentId],
    ["model", `${status.provider}/${status.model}`],
  ];
  if (status.git_branch) {
    rows.push(["branch", status.git_branch]);
  }

  const changedFiles = Array.isArray(state.files_touched) ? state.files_touched.length : 0;
  const { added, removed } = summarizeFileDiffs(state.file_diffs);
  if (changedFiles > 0 || added > 0 || removed > 0) {
    const changedSummary = [`${changedFiles} files`];
    if (added > 0) {
      changedSummary.push(`+${added}`);
    }
    if (removed > 0) {
      changedSummary.push(`-${removed}`);
    }
    rows.push(["changes", changedSummary.join("  ")]);
  } else {
    rows.push(["changes", "0 files"]);
  }

  if (status.message_count > 0) {
    rows.push(["messages", `${status.message_count}`]);
  }

  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `${renderAccent(label.padEnd(labelWidth, " "))}  ${renderMuted(value)}`)
    .join("\n");
}

function summarizeFileDiffs(
  fileDiffs: Record<string, { added: number; removed: number }> | undefined,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  if (!fileDiffs) {
    return { added, removed };
  }
  for (const value of Object.values(fileDiffs)) {
    added += typeof value?.added === "number" ? value.added : 0;
    removed += typeof value?.removed === "number" ? value.removed : 0;
  }
  return { added, removed };
}

function steeringQueueSubmissions(payload: Record<string, unknown>): PromptSubmission[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const submissions: PromptSubmission[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const value = item as Record<string, unknown>;
    const text = typeof value.display_content === "string"
      ? value.display_content
      : typeof value.content === "string"
        ? value.content
        : "";
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

function formatResumeCommand(sessionId: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(sessionId)) {
    return `chump -s ${sessionId}`;
  }
  return `chump -s '${sessionId.replace(/'/g, `'\\''`)}'`;
}
