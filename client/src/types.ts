export type ChumpConfig = {
  agentId: string;
  serverUrl: string;
  workspaceRoot: string;
};

export type SlashCommand =
  | "help"
  | "status"
  | "state"
  | "clear"
  | "agent"
  | "events"
  | "quit";

