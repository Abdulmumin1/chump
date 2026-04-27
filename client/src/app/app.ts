import { createInterface } from "node:readline/promises";
import process, { stdin as input, stdout as output } from "node:process";

import {
  clearMessages,
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
import { startEventStream } from "../ui/events.ts";
import { readPrompt } from "../ui/input.ts";
import {
  renderServerStatus,
  renderSessions,
  renderStoredMessages,
} from "../ui/output.ts";
import {
  createMarkdownStream,
  renderError,
  renderMuted,
} from "../ui/render.ts";
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
  let closeEventStream: (() => void) | null = null;

  if (target.note) {
    console.log(`[server] ${target.note}`);
  }
  console.log(renderBanner(config));
  closeEventStream = await startEventStream(config);

  try {
    while (true) {
      const nextLine = await readPrompt(fallbackRl);
      if (nextLine === null) {
        break;
      }

      const line = nextLine.trim();
      if (!line) {
        continue;
      }

      const commandResult = await handleSlashCommand(line, {
        config,
        closeEventStream,
        metadata: target.metadata,
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

      await runChatTurn(config, line);
    }
  } finally {
    closeEventStream?.();
    fallbackRl?.close();
  }
}

async function runChatTurn(config: ChumpConfig, line: string): Promise<void> {
  const spinner = createSpinner();
  spinner.start();
  let receivedChunk = false;
  let markdownStream: ReturnType<typeof createMarkdownStream> | null = null;

  await streamChat(config, line, {
    onChunk: (chunk) => {
      spinner.stop();
      receivedChunk = true;
      markdownStream ??= createMarkdownStream();
      markdownStream.write(chunk);
    },
    onEnd: () => {
      spinner.stop();
      if (!receivedChunk) {
        process.stdout.write(`${renderMuted("(no response)")}\n`);
        return;
      }
      markdownStream?.end();
      process.stdout.write("\n");
    },
    onError: (message) => {
      spinner.stop();
      process.stdout.write(`\n${renderError(`[chat] ${message}`)}\n`);
    },
  });
}

async function handleSlashCommand(
  line: string,
  context: {
    config: ReturnType<typeof loadConfig>;
    closeEventStream: (() => void) | null;
    metadata: ManagedServerMetadata | null;
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
      renderServerStatus(health, status, context.metadata);
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

      if (mode === "new") {
        config = switchAgent(config, createSessionId(config.workspaceRoot));
        closeEventStream = await context.restartEventStream(config);
        console.log(`started new session ${config.agentId}`);
        break;
      }

      config = switchAgent(config, mode);
      closeEventStream = await context.restartEventStream(config);
      console.log(`switched session to ${config.agentId}`);
      break;
    }
    case "agent": {
      const nextAgentId = parsed.args[0];
      if (!nextAgentId) {
        console.log("usage: /agent <id>");
        break;
      }
      config = switchAgent(config, nextAgentId);
      closeEventStream = await context.restartEventStream(config);
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
      return "quit";
  }

  return { config, closeEventStream };
}
