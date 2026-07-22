import type {
  ChumpConfig,
  ModelSuggestion,
  SessionSummary,
  SlashCommand,
  SlashCommandMenuContext,
  SlashCommandSuggestion,
  SlashCommandSuggestionView,
} from "../core/types.ts";
import { writeOutputLine, withDraftPaused } from "../ui/terminal.ts";

const ROOT_COMMANDS: Array<{
  label: string;
  command: string;
  description: string;
  action: "submit" | "fill";
}> = [
  {
    label: "/help",
    command: "/help",
    description: "show available commands",
    action: "submit",
  },
  {
    label: "/status",
    command: "/status",
    description: "show current session details",
    action: "submit",
  },
  {
    label: "/reload",
    command: "/reload",
    description: "restart and reconnect to the managed server",
    action: "submit",
  },
  {
    label: "/sessions",
    command: "/session ",
    description: "pick a stored session",
    action: "fill",
  },
  {
    label: "/model",
    command: "/model ",
    description: "choose provider and model",
    action: "fill",
  },
  {
    label: "/share",
    command: "/share ",
    description: "start, inspect, or stop remote sharing",
    action: "fill",
  },
  {
    label: "/thinking",
    command: "/thinking ",
    description: "choose reasoning level",
    action: "fill",
  },
  {
    label: "/mcps",
    command: "/mcps ",
    description: "view connected MCP servers",
    action: "fill",
  },
  {
    label: "/clear",
    command: "/clear",
    description: "clear messages for the current session",
    action: "submit",
  },
  {
    label: "/compact",
    command: "/compact",
    description: "summarize old context and keep recent messages",
    action: "submit",
  },
  {
    label: "/new",
    command: "/new",
    description: "start a fresh session",
    action: "submit",
  },
  {
    label: "/quit",
    command: "/quit",
    description: "exit chump",
    action: "submit",
  },
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
    return [sessionSuggestions.map(toSuggestionView), line, sessionSuggestions];
  }

  const modelSuggestions = completeModelCommand(line, context.models);
  if (modelSuggestions.length > 0) {
    return [modelSuggestions.map(toSuggestionView), line, modelSuggestions];
  }

  const shareSuggestions = completeShareCommand(line);
  if (shareSuggestions.length > 0) {
    return [shareSuggestions.map(toSuggestionView), line, shareSuggestions];
  }

  const thinkingSuggestions = completeThinkingCommand(line);
  if (thinkingSuggestions.length > 0) {
    return [
      thinkingSuggestions.map(toSuggestionView),
      line,
      thinkingSuggestions,
    ];
  }

  const mcpSuggestions = completeMcpCommand(line, context.mcps);
  if (mcpSuggestions.length > 0) {
    return [mcpSuggestions.map(toSuggestionView), line, mcpSuggestions];
  }

  const skillSuggestions = completeSkillCommand(line, context.skills);
  if (skillSuggestions.length > 0) {
    return [
      skillSuggestions.map(toSuggestionView),
      line,
      skillSuggestions,
    ];
  }

  const skillCommands = context.skills.map((skill) => ({
    label: `/skill:${skill.name}`,
    command: `/skill:${skill.name}`,
    description: skill.description,
    kind: "skill" as const,
    action: "submit" as const,
  }));
  const rootCommands = ROOT_COMMANDS.map(toSuggestion).filter((command) =>
    command.label.startsWith(line)
  );
  const skillQuery = line.slice(1);
  const matchingSkills = skillCommands.filter((command) =>
    matchesSkillQuery(command, skillQuery)
  );
  const hits = [...rootCommands, ...matchingSkills];
  const suggestions =
    hits.length > 0
      ? hits
      : line === "/"
        ? [...ROOT_COMMANDS.map(toSuggestion), ...skillCommands]
        : [];
  return [suggestions.map(toSuggestionView), line, suggestions];
}

function matchesSkillQuery(
  skill: Pick<SlashCommandSuggestion, "label" | "description">,
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/[\s:_-]+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const searchable = `${skill.label.slice("/skill:".length)} ${skill.description}`
    .toLowerCase()
    .replace(/[\s:_-]+/g, " ");
  return terms.every((term) => searchable.includes(term));
}

function completeSkillCommand(
  line: string,
  skills: SlashCommandMenuContext["skills"],
): SlashCommandSuggestion[] {
  const match = /^\/skill:([^\s]*)$/.exec(line);
  if (!match) {
    return [];
  }
  const query = (match[1] ?? "").toLowerCase();
  return skills
    .filter((skill) => !query || skill.name.toLowerCase().startsWith(query))
    .map((skill) => ({
      label: `/skill:${skill.name}`,
      command: `/skill:${skill.name}`,
      description: skill.description,
      kind: "skill" as const,
      action: "submit" as const,
    }));
}

function completeThinkingCommand(line: string): SlashCommandSuggestion[] {
  if (!/^\/thinking\s/.test(line)) {
    return [];
  }

  const query = line.slice("/thinking".length).trim().toLowerCase();
  return THINKING_COMMANDS.filter(
    (command) => !query || command.label.startsWith(query),
  ).map((command) => ({
    label: command.label,
    command: `/thinking ${command.label}`,
    description: command.description,
    kind: "command" as const,
    action: "submit" as const,
  }));
}

function completeShareCommand(line: string): SlashCommandSuggestion[] {
  if (!/^\/share\s/.test(line)) {
    return [];
  }

  const query = line.slice("/share".length).trim().toLowerCase();
  const items = [
    {
      label: "start",
      command: "/share",
      description: "open a public Onlocal URL for this local server",
    },
    {
      label: "status",
      command: "/share status",
      description: "show the current share target",
    },
    {
      label: "stop",
      command: "/share stop",
      description: "shut down the current share tunnel",
    },
  ];

  return items
    .filter((item) => !query || item.label.startsWith(query))
    .map((item) => ({
      ...item,
      kind: "command" as const,
      action: "submit" as const,
    }));
}

function completeMcpCommand(
  line: string,
  mcps: SlashCommandMenuContext["mcps"] = [],
): SlashCommandSuggestion[] {
  if (!/^\/mcp(?:s)?(?:\s.*)?$/i.test(line)) {
    return [];
  }

  const match = /^\/mcp(?:s)?(?:\s+(.*))?$/i.exec(line);
  if (!match) {
    return [];
  }
  const query = (match[1] ?? "").trim().toLowerCase();

  const matching = mcps.filter((mcp) => {
    if (!query) {
      return true;
    }
    return (
      mcp.name.toLowerCase().includes(query) ||
      mcp.type.toLowerCase().includes(query) ||
      mcp.status.toLowerCase().includes(query)
    );
  });

  if (matching.length === 0) {
    if (mcps.length === 0) {
      return [
        {
          label: "(no connected MCP servers)",
          command: "/mcps",
          description: "no MCP servers configured or connected",
          kind: "mcp" as const,
          action: "submit" as const,
        },
      ];
    }
    return [];
  }

  return matching.map((mcp) => {
    let desc = `${mcp.status} (${mcp.type})`;
    if (mcp.status === "connected") {
      desc = `connected · ${mcp.tools} tool${mcp.tools === 1 ? "" : "s"} (${mcp.type})`;
    } else if (mcp.error) {
      desc = `${mcp.status} · ${mcp.error} (${mcp.type})`;
    }
    return {
      label: mcp.name,
      command: `/mcps ${mcp.name}`,
      description: desc,
      kind: "mcp" as const,
      action: "submit" as const,
    };
  });
}

function completeModelCommand(
  line: string,
  models: ModelSuggestion[],
): SlashCommandSuggestion[] {
  if (!/^\/model\s/.test(line)) {
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
  if (!/^\/session\s/.test(line)) {
    return [];
  }

  const query = line.slice("/session".length).trim().toLowerCase();
  return sessions
    .filter((session) => {
      if (query.length === 0) {
        return true;
      }
      const title = sessionTitle(session).toLowerCase();
      return (
        title.includes(query) || session.id.toLowerCase().startsWith(query)
      );
    })
    .map((session) => ({
      label: sessionTitle(session),
      command: `/session ${session.id}`,
      description: describeSession(session),
      columns: {
        updated: session.updated_at
          ? formatSessionTime(session.updated_at)
          : "-",
        created: session.created_at
          ? formatSessionTime(session.created_at)
          : "-",
        conversation: sessionTitle(session),
      },
      kind: "session" as const,
      action: "submit" as const,
    }));
}

function describeSession(session: SessionSummary): string {
  const parts = [
    session.updated_at
      ? `updated ${formatSessionTime(session.updated_at)}`
      : null,
    session.created_at
      ? `created ${formatSessionTime(session.created_at)}`
      : null,
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

function toSuggestionView(
  suggestion: SlashCommandSuggestion,
): SlashCommandSuggestionView {
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

  const skillMatch = /^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(
    input.trim(),
  );
  if (skillMatch) {
    const name = skillMatch[1] ?? "";
    const args = skillMatch[2]?.trim();
    return {
      command: "skill",
      args: args ? [name, args] : [name],
    };
  }

  if (!input.startsWith("/")) {
    return null;
  }

  const parts = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;

  switch (command) {
    case "help":
    case "status":
    case "reload":
    case "sessions":
    case "clear":
    case "compact":
    case "agent":
    case "session":
    case "model":
    case "share":
    case "thinking":
    case "mcps":
    case "mcp":
    case "quit":
      return { command, args };
    default:
      return null;
  }
}

export function printHelp(): void {
  // Pause the input draft during help rendering to prevent
  // input box borders/controls from mixing with the content
  withDraftPaused(() => {
    for (const command of ROOT_COMMANDS) {
      writeOutputLine(command.label);
    }
    writeOutputLine("/session <id>");
    writeOutputLine("/agent <id>");
    writeOutputLine("/share [status|stop]");
    writeOutputLine("/thinking <none|low|high|xhigh>");
    writeOutputLine("/skill:<name> [args]");
    writeOutputLine("/compact");
  });
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
