import type { ChumpConfig, SlashCommand } from "../core/types.ts";
import { writeOutputLine } from "../ui/terminal.ts";

export const SLASH_COMMANDS = [
  "/help",
  "/status",
  "/state",
  "/messages",
  "/sessions",
  "/clear",
  "/session",
  "/session new",
  "/agent",
  "/events on",
  "/events off",
  "/quit",
] as const;

export function completeSlashCommand(line: string): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }

  const hits = SLASH_COMMANDS.filter((command) => command.startsWith(line));
  return [hits.length > 0 ? [...hits] : [...SLASH_COMMANDS], line];
}

export function parseSlashCommand(input: string): {
  command: SlashCommand;
  args: string[];
} | null {
  if (input.trim() === "quit") {
    return { command: "quit", args: [] };
  }

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
  for (const command of SLASH_COMMANDS) {
    writeOutputLine(command);
  }
  writeOutputLine("/session <id>");
  writeOutputLine("/agent <id>");
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
