export type ChumpConfig = {
  agentId: string;
  serverUrl: string;
  serverSource: "managed" | "direct";
  workspaceRoot: string;
};

export type CliMode = "interactive" | "client" | "server" | "status" | "stop" | "help";

export type CliOptions = {
  mode: CliMode;
  connectUrl: string | null;
  autoStartServer: boolean;
};

export type ManagedServerMetadata = {
  url: string;
  port: number;
  pid: number | null;
  workspace_root: string;
  data_dir: string;
  log_path: string;
  started_at: string;
};

export type ChumpStatus = {
  agent_id: string;
  workspace_root: string;
  provider: string;
  model: string;
  max_steps: number;
  command_timeout: number;
  reasoning: Record<string, unknown> | null;
  verbose: boolean;
  message_count: number;
  last_user_goal: string | null;
};

export type ChumpHealth = {
  status: string;
  version: string;
  ai_query_version: string;
  workspace_root: string;
  data_dir: string;
  provider: string;
  model: string;
  max_steps: number;
  command_timeout: number;
  reasoning: Record<string, unknown> | null;
  verbose: boolean;
  active_sessions: number;
  uptime_seconds: number;
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

export type StoredMessage = {
  role: string;
  content: unknown;
};

export type AgentMessagesResponse = {
  messages: StoredMessage[];
};

export type StoredEvent = {
  id: number;
  type: string;
  data: Record<string, unknown>;
};

export type AgentEventLogResponse = {
  events: StoredEvent[];
};

export type SessionSummary = {
  id: string;
  active: boolean;
  message_count: number;
  event_count: number;
  last_user_goal: string | null;
  last_activity: number | null;
  connections: number;
};

export type SessionsResponse = {
  sessions: SessionSummary[];
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
  | "messages"
  | "sessions"
  | "clear"
  | "agent"
  | "session"
  | "events"
  | "quit";
