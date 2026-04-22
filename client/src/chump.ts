#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  clearMessages,
  getState,
  getStatus,
  openEventStream,
  streamChat,
} from "./api.ts";
import { parseSlashCommand, printHelp, switchAgent } from "./commands.ts";
import { loadConfig, renderBanner } from "./config.ts";
import type { SseEvent } from "./types.ts";

async function main(): Promise<void> {
  let config = loadConfig();
  const rl = readline.createInterface({ input, output });
  let closeEventStream: (() => void) | null = null;

  console.log(renderBanner(config));

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
            const status = await getStatus(config);
            console.log(JSON.stringify(status, null, 2));
            break;
          }
          case "state": {
            const state = await getState(config);
            console.log(JSON.stringify(state, null, 2));
            break;
          }
          case "clear": {
            const result = await clearMessages(config);
            console.log(JSON.stringify(result, null, 2));
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
            console.log(`switched agent to ${config.agentId}`);
            break;
          }
          case "events": {
            const mode = parsed.args[0];
            if (mode === "on") {
              closeEventStream?.();
              closeEventStream = await openEventStream(config, {
                onEvent: (event) => logEvent(event),
                onError: (error) => console.error(`[events] ${error.message}`),
              });
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

function logEvent(event: SseEvent): void {
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
