import type {
  ChumpConfig,
  SessionSummary,
  SlashCommand,
  SlashCommandMenuContext,
  SlashCommandSuggestion,
  SlashCommandSuggestionView,
} from "../core/types.ts";
import { writeOutputLine } from "../ui/terminal.ts";

const ROOT_COMMANDS: Array<{
  label: string;
  command: string;
  description: string;
  action: "submit" | "fill";
}> = [
  { label: "/help", command: "/help", description: "show available commands", action: "submit" },
  { label: "/status", command: "/status", description: "show server and session status", action: "submit" },
  { label: "/state", command: "/state", description: "print the current agent state", action: "submit" },
  { label: "/messages", command: "/messages", description: "show stored raw session messages", action: "submit" },
  { label: "/sessions", command: "/session ", description: "pick a stored session", action: "fill" },
  { label: "/clear", command: "/clear", description: "clear messages for the current session", action: "submit" },
  { label: "/new", command: "/new", description: "start a fresh session", action: "submit" },
  { label: "/events on", command: "/events on", description: "enable live event rendering", action: "submit" },
  { label: "/events off", command: "/events off", description: "disable live event rendering", action: "submit" },
  { label: "/quit", command: "/quit", description: "exit chump", action: "submit" },
];

export function completeSlashCommand(
  line: string,
  context: SlashCommandMenuContext,
): [SlashCommandSuggestionView[], string, SlashCommandSuggestion[]] {
  if (!line.startsWith("/")) {
    return [[], line, []];
  }

  const sessionSuggestions = completeSessionCommand(line, context.sessions);
  if (sessionSuggestions.length > 0) {
    return [
      sessionSuggestions.map(toSuggestionView),
      line,
      sessionSuggestions,
    ];
  }

  const hits = ROOT_COMMANDS
    .filter((command) => command.label.startsWith(line))
    .map(toSuggestion);
  const suggestions =
    hits.length > 0
      ? hits
      : line === "/" ? ROOT_COMMANDS.map(toSuggestion) : [];
  return [
    suggestions.map(toSuggestionView),
    line,
    suggestions,
  ];
}

function completeSessionCommand(
  line: string,
  sessions: SessionSummary[],
): SlashCommandSuggestion[] {
  if (!/^\/session(?:\s|$)/.test(line)) {
    return [];
  }

  const query = line.slice("/session".length).trim();
  return sessions
    .filter((session) => query.length === 0 || session.id.startsWith(query))
    .map((session) => ({
      label: session.id,
      command: `/session ${session.id}`,
      description: describeSession(session),
      action: "submit" as const,
    }));
}

function describeSession(session: SessionSummary): string {
  const parts = [`${session.message_count} msgs`];
  if (session.active) {
    parts.push("active");
  }
  if (session.last_user_goal) {
    parts.push(session.last_user_goal);
  }
  return parts.join(" · ");
}

function toSuggestion(command: {
  label: string;
  command: string;
  description: string;
  action: "submit" | "fill";
}): SlashCommandSuggestion {
  return {
    label: command.label,
    command: command.command,
    description: command.description,
    action: command.action,
  };
}

function toSuggestionView(suggestion: SlashCommandSuggestion): SlashCommandSuggestionView {
  return {
    label: suggestion.label,
    command: suggestion.command,
    description: suggestion.description,
  };
}

export function parseSlashCommand(input: string): {
  command: SlashCommand;
  args: string[];
} | null {
  if (input.trim() === "quit") {
    return { command: "quit", args: [] };
  }

  if (input.trim() === "/new") {
    return { command: "session", args: ["new"] };
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
  for (const command of ROOT_COMMANDS) {
    writeOutputLine(command.label);
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
