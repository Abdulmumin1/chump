export type ChumpConfig = {
  agentId: string;
  serverUrl: string;
  serverSource: "managed" | "direct";
  workspaceRoot: string;
};

export type CliMode =
  | "interactive"
  | "client"
  | "server"
  | "status"
  | "stop"
  | "connect"
  | "update"
  | "version"
  | "help";

export type CliOptions = {
  mode: CliMode;
  connectUrl: string | null;
  sessionId: string | null;
  autoStartServer: boolean;
};

export type ManagedServerMetadata = {
  url: string;
  port: number;
  pid: number | null;
  command: string;
  command_args: string[];
  command_source: "local" | "installed";
  workspace_root: string;
  data_dir: string;
  log_path: string;
  started_at: string;
};

export type ChumpStatus = {
  agent_id: string;
  workspace_root: string;
  git_branch?: string;
  provider: string;
  model: string;
  max_steps: number;
  command_timeout: number;
  managed_idle_timeout: number | null;
  compaction?: CompactionStatus | null;
  reasoning: Record<string, unknown> | null;
  verbose: boolean;
  message_count: number;
  title: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_user_goal: string | null;
  turn_running?: boolean;
  steering_queue?: SteeringQueueItem[];
  instruction_files: string[];
  skills: SkillSummary[];
  usage?: UsageSummary | null;
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
  managed_idle_timeout: number | null;
  reasoning: Record<string, unknown> | null;
  verbose: boolean;
  active_sessions: number;
  active_connections: number;
  uptime_seconds: number;
  instruction_files: string[];
  skills: SkillSummary[];
};

export type ChumpState = {
  workspace_root: string;
  title: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_user_goal: string | null;
  files_touched: string[];
  commands_run: string[];
  notes: string[];
  file_diffs?: Record<string, { added: number; removed: number }>;
};

export type AgentStateResponse =
  | ChumpState
  | {
      agent_id?: string;
      state: ChumpState;
    };

export type StoredMessage = {
  role: string;
  content: unknown;
};

export type ImageAttachment = {
  type: "image";
  label: string;
  filename: string;
  mime: string;
  data: string;
};

export type TextAttachment = {
  type: "text";
  label: string;
  text: string;
};

export type ChatAttachment = ImageAttachment | TextAttachment;

export type PromptSubmission = {
  text: string;
  attachments: ChatAttachment[];
};

export type SteeringQueueItem = {
  content: string;
  display_content?: string;
  attachments?: Array<Record<string, unknown>>;
  steered?: boolean;
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
  title: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_user_goal: string | null;
  last_activity: number | null;
  connections: number;
};

export type SessionsResponse = {
  sessions: SessionSummary[];
};

export type SkillSummary = {
  name: string;
  description: string;
};

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
};

export type UsageSummary = {
  last_step: UsageStats | null;
  current_turn: UsageStats | null;
  last_turn: UsageStats | null;
  session_total: UsageStats | null;
};

export type CompactionStatus = {
  threshold_tokens: number | null;
  keep_recent_tokens: number;
  estimated_tokens: number;
  message_count: number;
  last: CompactionResult | null;
};

export type CompactionResult = {
  status: string;
  reason?: string;
  tokens_before?: number;
  messages_before?: number;
  messages_after?: number;
  compacted_messages?: number;
  kept_messages?: number;
  summary_chars?: number;
  created_at?: number;
  message_count?: number;
  estimated_tokens?: number;
};

export type ShareStatus = {
  provider: "onlocal";
  publicUrl: string;
  localUrl: string;
  connectUrl: string | null;
  startedAt: number;
};

export type SseEvent = {
  event: string;
  data: string;
  id?: string;
};

export type TranscriptEvent =
  | { type: "assistant_text"; content: string }
  | { type: "user_message"; payload: Record<string, unknown> }
  | { type: "tool_call"; payload: Record<string, unknown> }
  | { type: "tool_result"; payload: Record<string, unknown> }
  | { type: "reasoning"; payload: Record<string, unknown> }
  | { type: "agent_status"; payload: Record<string, unknown> }
  | { type: "steering_queue"; payload: Record<string, unknown> }
  | { type: "turn_status"; payload: Record<string, unknown> }
  | { type: "compaction_status"; payload: Record<string, unknown> }
  | { type: "stream_end"; fallback?: string }
  | { type: "stream_error"; message: string; aborted?: boolean };

export type SlashCommandSuggestion = {
  label: string;
  command: string;
  description: string;
  columns?: SlashCommandSuggestionView["columns"];
  kind?: SlashCommandSuggestionView["kind"];
  action: "submit" | "fill";
};

export type SlashCommandMenuContext = {
  sessions: SessionSummary[];
  models: ModelSuggestion[];
  skills: SkillSummary[];
};

export type ModelSuggestion = {
  provider: string;
  model: string;
  label: string;
  description: string;
};

export type SlashCommandSuggestionView = {
  label: string;
  command: string;
  description: string;
  columns?: {
    updated: string;
    created: string;
    conversation: string;
  };
  kind?: "model" | "session" | "skill" | "command";
};

export type SlashCommand =
  | "help"
  | "status"
  | "sessions"
  | "clear"
  | "compact"
  | "agent"
  | "session"
  | "model"
  | "share"
  | "skill"
  | "thinking"
  | "quit";
