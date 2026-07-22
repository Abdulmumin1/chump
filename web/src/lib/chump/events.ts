export const CHUMP_EVENT_SCHEMA_VERSION = 1 as const;

export const CHUMP_EVENT_TYPES = [
  "assistant_text",
  "user_message",
  "tool_call",
  "tool_result",
  "agent_status",
  "steering_queue",
  "turn_status",
  "turn_error",
  "compaction_status",
  "compaction",
  "status",
] as const;

export type ChumpEventType = (typeof CHUMP_EVENT_TYPES)[number];
export type JsonRecord = Record<string, unknown>;
export type VersionedEventPayload = JsonRecord & {
  schema_version: typeof CHUMP_EVENT_SCHEMA_VERSION;
};

export type SteeringItem = JsonRecord & {
  content: string;
  display_content?: string;
  attachments?: JsonRecord[];
  steered?: boolean;
};

export type AssistantTextPayload = VersionedEventPayload & { content: string };
export type UserMessagePayload = VersionedEventPayload & SteeringItem;
export type ToolCallPayload = VersionedEventPayload & {
  name: string;
  call_id: string;
  args: JsonRecord;
  step: number;
  index: number;
  status?: "ready";
};
export type ToolResultPayload = VersionedEventPayload & {
  name: string;
  call_id: string;
  ok: boolean;
  status: "ok" | "error";
  preview: string;
  step: number;
  index: number;
  duration?: number | null;
  error?: string;
};
export type AgentStatusPayload = VersionedEventPayload & {
  agent_id: string;
  provider: string;
  model: string;
  turn_running?: boolean;
};
export type SteeringQueuePayload = VersionedEventPayload & {
  items: SteeringItem[];
};
export type TurnStatusPayload = VersionedEventPayload & {
  running: boolean;
  steering_queue: SteeringItem[];
};
export type TurnErrorPayload = VersionedEventPayload & {
  message: string;
  error_type: string;
};
export type CompactionStatusPayload = VersionedEventPayload & {
  running: boolean;
  reason: string;
  tokens_before?: number;
  messages_before?: number;
};
export type CompactionPayload = VersionedEventPayload & {
  reason: string;
  tokens_before: number;
  tokens_after: number;
  messages_before: number;
  messages_after: number;
  compacted_messages?: number;
  kept_messages?: number;
  summary_chars?: number;
  created_at: number;
};
export type StepStatusPayload = VersionedEventPayload & {
  phase: "step_start" | "step_finish";
  step: number;
};

export type ChumpEvent =
  | { type: "assistant_text"; data: AssistantTextPayload }
  | { type: "user_message"; data: UserMessagePayload }
  | { type: "tool_call"; data: ToolCallPayload }
  | { type: "tool_result"; data: ToolResultPayload }
  | { type: "agent_status"; data: AgentStatusPayload }
  | { type: "steering_queue"; data: SteeringQueuePayload }
  | { type: "turn_status"; data: TurnStatusPayload }
  | { type: "turn_error"; data: TurnErrorPayload }
  | { type: "compaction_status"; data: CompactionStatusPayload }
  | { type: "compaction"; data: CompactionPayload }
  | { type: "status"; data: StepStatusPayload };

const EVENT_TYPE_SET = new Set<string>(CHUMP_EVENT_TYPES);

export function isChumpEventType(type: string): type is ChumpEventType {
  return EVENT_TYPE_SET.has(type);
}

export function parseChumpEvent(type: string, data: unknown): ChumpEvent | null {
  if (!isChumpEventType(type) || !isRecord(data)) return null;
  if (
    data.schema_version !== undefined &&
    data.schema_version !== CHUMP_EVENT_SCHEMA_VERSION
  ) {
    return null;
  }

  const versioned = {
    ...data,
    schema_version: CHUMP_EVENT_SCHEMA_VERSION,
  };

  switch (type) {
    case "assistant_text":
      return isString(data.content)
        ? { type, data: versioned as AssistantTextPayload }
        : null;
    case "user_message":
      return isString(data.content)
        ? { type, data: versioned as UserMessagePayload }
        : null;
    case "tool_call":
      return isString(data.name) &&
          isString(data.call_id) &&
          isRecord(data.args) &&
          isInteger(data.step) &&
          isInteger(data.index)
        ? { type, data: versioned as ToolCallPayload }
        : null;
    case "tool_result":
      return isString(data.name) &&
          isString(data.call_id) &&
          typeof data.ok === "boolean" &&
          (data.status === "ok" || data.status === "error") &&
          isString(data.preview) &&
          isInteger(data.step) &&
          isInteger(data.index)
        ? { type, data: versioned as ToolResultPayload }
        : null;
    case "agent_status":
      return isString(data.agent_id) &&
          isString(data.provider) &&
          isString(data.model)
        ? { type, data: versioned as AgentStatusPayload }
        : null;
    case "steering_queue":
      return Array.isArray(data.items)
        ? { type, data: versioned as SteeringQueuePayload }
        : null;
    case "turn_status":
      return typeof data.running === "boolean" &&
          Array.isArray(data.steering_queue)
        ? { type, data: versioned as TurnStatusPayload }
        : null;
    case "turn_error":
      return isString(data.message) && isString(data.error_type)
        ? { type, data: versioned as TurnErrorPayload }
        : null;
    case "compaction_status":
      return typeof data.running === "boolean" && isString(data.reason)
        ? { type, data: versioned as CompactionStatusPayload }
        : null;
    case "compaction":
      return isString(data.reason) &&
          isInteger(data.tokens_before) &&
          isInteger(data.tokens_after) &&
          isInteger(data.messages_before) &&
          isInteger(data.messages_after) &&
          typeof data.created_at === "number"
        ? { type, data: versioned as CompactionPayload }
        : null;
    case "status":
      return (data.phase === "step_start" || data.phase === "step_finish") &&
          isInteger(data.step)
        ? { type, data: versioned as StepStatusPayload }
        : null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
