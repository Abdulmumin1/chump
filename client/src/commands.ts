import type { ChumpConfig, SlashCommand } from "./types.ts";

export function parseSlashCommand(input: string): {
  command: SlashCommand;
  args: string[];
} | null {
  if (!input.startsWith("/")) {
    return null;
  }

  const parts = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;

  switch (command) {
    case "help":
    case "status":
    case "state":
    case "messages":
    case "sessions":
    case "clear":
    case "agent":
    case "session":
    case "events":
    case "quit":
      return { command, args };
    default:
      return null;
  }
}

export function printHelp(): void {
  console.log("/help");
  console.log("/status");
  console.log("/state");
  console.log("/messages");
  console.log("/sessions");
  console.log("/clear");
  console.log("/session");
  console.log("/session new");
  console.log("/session <id>");
  console.log("/agent <id>");
  console.log("/events on|off");
  console.log("/quit");
}

export function switchAgent(
  config: ChumpConfig,
  nextAgentId: string,
): ChumpConfig {
  return {
    ...config,
    agentId: nextAgentId,
  };
}
