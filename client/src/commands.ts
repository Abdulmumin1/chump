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
    case "clear":
    case "agent":
    case "events":
    case "quit":
      return { command, args };
    default:
      return null;
  }
}

export function runLocalCommand(
  config: ChumpConfig,
  input: string,
): { handled: boolean; shouldExit?: boolean; nextConfig?: ChumpConfig } {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return { handled: false };
  }

  switch (parsed.command) {
    case "help":
      console.log("/help");
      console.log("/status");
      console.log("/state");
      console.log("/clear");
      console.log("/agent <id>");
      console.log("/events on|off");
      console.log("/quit");
      return { handled: true };
    case "status":
      console.log(`agent=${config.agentId} server=${config.serverUrl}`);
      return { handled: true };
    case "agent": {
      const nextAgentId = parsed.args[0];
      if (!nextAgentId) {
        console.log("usage: /agent <id>");
        return { handled: true };
      }
      return {
        handled: true,
        nextConfig: {
          ...config,
          agentId: nextAgentId,
        },
      };
    }
    case "events":
      console.log("event streaming is scaffolded but not wired yet");
      return { handled: true };
    case "state":
    case "clear":
      console.log(`${parsed.command} is reserved for backend action wiring`);
      return { handled: true };
    case "quit":
      return { handled: true, shouldExit: true };
  }
}

