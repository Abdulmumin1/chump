import type {
  ChumpConfig,
  ModelSuggestion,
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
  { label: "/sessions", command: "/session ", description: "pick a stored session", action: "fill" },
  { label: "/model", command: "/model ", description: "choose provider and model", action: "fill" },
  { label: "/thinking", command: "/thinking ", description: "choose reasoning level", action: "fill" },
  { label: "/clear", command: "/clear", description: "clear messages for the current session", action: "submit" },
  { label: "/new", command: "/new", description: "start a fresh session", action: "submit" },
  { label: "/quit", command: "/quit", description: "exit chump", action: "submit" },
];

const THINKING_COMMANDS = [
  { label: "none", description: "disable model thinking" },
  { label: "low", description: "small thinking budget" },
  { label: "high", description: "larger thinking budget" },
  { label: "xhigh", description: "maximum thinking budget" },
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

  const modelSuggestions = completeModelCommand(line, context.models);
  if (modelSuggestions.length > 0) {
    return [
      modelSuggestions.map(toSuggestionView),
      line,
      modelSuggestions,
    ];
  }

  const thinkingSuggestions = completeThinkingCommand(line);
  if (thinkingSuggestions.length > 0) {
    return [
      thinkingSuggestions.map(toSuggestionView),
      line,
      thinkingSuggestions,
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

function completeThinkingCommand(line: string): SlashCommandSuggestion[] {
  if (!/^\/thinking(?:\s|$)/.test(line)) {
    return [];
  }

  const query = line.slice("/thinking".length).trim().toLowerCase();
  return THINKING_COMMANDS
    .filter((command) => !query || command.label.startsWith(query))
    .map((command) => ({
      label: command.label,
      command: `/thinking ${command.label}`,
      description: command.description,
      kind: "command" as const,
      action: "submit" as const,
    }));
}

function completeModelCommand(
  line: string,
  models: ModelSuggestion[],
): SlashCommandSuggestion[] {
  if (!/^\/model(?:\s|$)/.test(line)) {
    return [];
  }

  const query = line.slice("/model".length).trim().toLowerCase();
  return models
    .filter((model) => {
      if (!query) {
        return true;
      }
      return model.label.toLowerCase().includes(query);
    })
    .map((model) => ({
      label: model.label,
      command: `/model ${model.label}`,
      description: model.description,
      kind: "model" as const,
      action: "submit" as const,
    }));
}

function completeSessionCommand(
  line: string,
  sessions: SessionSummary[],
): SlashCommandSuggestion[] {
  if (!/^\/session(?:\s|$)/.test(line)) {
    return [];
  }

  const query = line.slice("/session".length).trim().toLowerCase();
  return sessions
    .filter((session) => {
      if (query.length === 0) {
        return true;
      }
      const title = sessionTitle(session).toLowerCase();
      return title.includes(query) || session.id.toLowerCase().startsWith(query);
    })
    .map((session) => ({
      label: sessionTitle(session),
      command: `/session ${session.id}`,
      description: describeSession(session),
      columns: {
        updated: session.updated_at ? formatSessionTime(session.updated_at) : "-",
        created: session.created_at ? formatSessionTime(session.created_at) : "-",
        conversation: sessionTitle(session),
      },
      kind: "session" as const,
      action: "submit" as const,
    }));
}

function describeSession(session: SessionSummary): string {
  const parts = [
    session.updated_at ? `updated ${formatSessionTime(session.updated_at)}` : null,
    session.created_at ? `created ${formatSessionTime(session.created_at)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function sessionTitle(session: SessionSummary): string {
  const title = session.title?.trim() || session.last_user_goal?.trim();
  return clipSessionTitle(title || "Untitled session");
}

function clipSessionTitle(value: string): string {
  if (value.length <= 72) {
    return value;
  }
  return `${value.slice(0, 69).trimEnd()}...`;
}

function formatSessionTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function toSuggestion(command: {
  label: string;
  command: string;
  description: string;
  columns?: SlashCommandSuggestionView["columns"];
  kind?: SlashCommandSuggestionView["kind"];
  action: "submit" | "fill";
}): SlashCommandSuggestion {
  return {
    label: command.label,
    command: command.command,
    description: command.description,
    action: command.action,
    kind: command.kind ?? "command",
  };
}

function toSuggestionView(suggestion: SlashCommandSuggestion): SlashCommandSuggestionView {
  return {
    label: suggestion.label,
    command: suggestion.command,
    description: suggestion.description,
    columns: suggestion.columns,
    kind: suggestion.kind,
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
    case "sessions":
    case "clear":
    case "agent":
    case "session":
    case "model":
    case "thinking":
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
  writeOutputLine("/thinking <none|low|high|xhigh>");
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
