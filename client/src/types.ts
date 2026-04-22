export type ChumpConfig = {
  agentId: string;
  serverUrl: string;
  workspaceRoot: string;
};

export type ChumpStatus = {
  agent_id: string;
  workspace_root: string;
  provider: string;
  model: string;
  message_count: number;
  last_user_goal: string | null;
};

export type ChumpState = {
  workspace_root: string;
  last_user_goal: string | null;
  files_touched: string[];
  commands_run: string[];
  notes: string[];
};

export type AgentStateResponse = {
  agent_id: string;
  state: ChumpState;
};

export type SseEvent = {
  event: string;
  data: string;
  id?: string;
};

export type SlashCommand =
  | "help"
  | "status"
  | "state"
  | "clear"
  | "agent"
  | "events"
  | "quit";
