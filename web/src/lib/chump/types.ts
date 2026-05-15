export type ChumpHealth = {	
	status: string;
	version: string;
	ai_query_version: string;
	workspace_root: string;
	git_branch?: string;
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
	skills: Array<{ name: string; description: string }>;
	models?: string[];
	available_providers?: string[];
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

export type TextMessagePart = {
	type: 'text';
	text: string;
};

export type ReasoningMessagePart = {
	type: 'reasoning';
	text: string;
	data?: Record<string, unknown>;
};

export type ToolCallMessagePart = {
	type: 'tool_call';
	tool_call: {
		id: string;
		name: string;
		arguments?: Record<string, unknown>;
	};
};

export type ToolResultMessagePart = {
	type: 'tool_result';
	tool_result: {
		tool_call_id: string;
		tool_name: string;
		result: unknown;
		is_error: boolean;
	};
};

export type ImageMessagePart = {
	type: 'image';
	image?: string;
	media_type?: string;
};

export type UnknownMessagePart = {
	type?: string;
	[key: string]: unknown;
};

export type MessagePart =
	| TextMessagePart
	| ReasoningMessagePart
	| ToolCallMessagePart
	| ToolResultMessagePart
	| ImageMessagePart
	| UnknownMessagePart;

export type StoredMessage = {
	role: string;
	content: string | MessagePart[];
};

export type AgentMessagesResponse = {
	messages: StoredMessage[];
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
	read_files?: Record<string, { size: number; sha256: string }>;
};

export type AgentStateResponse = {
	agent_id: string;
	state: ChumpState;
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
	skills: Array<{ name: string; description: string }>;
};

export type SteeringQueueItem = {
	content: string;
	attachments?: Array<Record<string, unknown>>;
	steered?: boolean;
};

export type StoredEvent = {
	id: number;
	type: string;
	data: Record<string, unknown>;
};

export type AgentEventLogResponse = {
	events: StoredEvent[];
};

export type SseEvent = {
	event: string;
	data: string;
	id?: string;
};

export type ChatAttachment = {
	type: "image";
	label: string;
	filename: string;
	mime: string;
	data: string;
};
