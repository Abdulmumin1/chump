export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DelegatedSessionStartingEvent = {
  type: "session_starting";
};

export type DelegatedReasoningEvent = {
  type: "reasoning";
  text: string;
};

export type DelegatedToolCallEvent = {
  type: "tool_call";
  name: string;
  callId: string;
  args: { [key: string]: JsonValue };
};

export type DelegatedToolResultEvent = {
  type: "tool_result";
  name: string;
  callId: string;
  status: "ok" | "error";
};

export type DelegatedAssistantTextEvent = {
  type: "assistant_text";
};

export type DelegatedStepStatusEvent = {
  type: "status";
  phase: "step_start" | "step_finish";
  step: number;
};

export type DelegatedTurnErrorEvent = {
  type: "turn_error";
  message: string;
};

export type DelegatedChildEvent =
  | DelegatedSessionStartingEvent
  | DelegatedReasoningEvent
  | DelegatedToolCallEvent
  | DelegatedToolResultEvent
  | DelegatedAssistantTextEvent
  | DelegatedStepStatusEvent
  | DelegatedTurnErrorEvent;

export type DelegatedSessionProgress = {
  parentCallId: string;
  parentStep: number;
  parentIndex: number;
  sessionId: string;
  event: DelegatedChildEvent;
};

/** Parse the ai-query tool progress envelope at the SSE boundary. */
export function parseDelegatedSessionProgress(
  value: unknown,
): DelegatedSessionProgress | null {
  const payload = jsonObject(value);
  if (!payload) return null;

  const data = jsonObject(payload.data);
  if (!data || data.kind !== "delegated_session") return null;

  const parentCallId = payload.call_id;
  const parentStep = payload.step;
  const parentIndex = payload.index;
  const sessionId = data.session_id;
  if (
    typeof parentCallId !== "string" ||
    typeof parentStep !== "number" ||
    typeof parentIndex !== "number" ||
    !Number.isInteger(parentStep) ||
    !Number.isInteger(parentIndex) ||
    typeof sessionId !== "string" ||
    !sessionId
  ) {
    return null;
  }

  const event = parseDelegatedChildEvent(data.event);
  if (!event) return null;

  return {
    parentCallId,
    parentStep,
    parentIndex,
    sessionId,
    event,
  };
}

function parseDelegatedChildEvent(value: JsonValue): DelegatedChildEvent | null {
  const event = jsonObject(value);
  if (!event || typeof event.type !== "string") return null;

  switch (event.type) {
    case "session_starting":
      return { type: "session_starting" };
    case "reasoning":
      return typeof event.text === "string"
        ? { type: "reasoning", text: event.text }
        : null;
    case "tool_call": {
      const args = jsonObject(event.args);
      return typeof event.name === "string" &&
          typeof event.call_id === "string" &&
          args
        ? {
          type: "tool_call",
          name: event.name,
          callId: event.call_id,
          args,
        }
        : null;
    }
    case "tool_result":
      return typeof event.name === "string" &&
          typeof event.call_id === "string" &&
          (event.status === "ok" || event.status === "error")
        ? {
          type: "tool_result",
          name: event.name,
          callId: event.call_id,
          status: event.status,
        }
        : null;
    case "assistant_text":
      return { type: "assistant_text" };
    case "status":
      return (event.phase === "step_start" || event.phase === "step_finish") &&
          Number.isInteger(event.step)
        ? { type: "status", phase: event.phase, step: event.step as number }
        : null;
    case "turn_error":
      return typeof event.message === "string"
        ? { type: "turn_error", message: event.message }
        : null;
    default:
      return null;
  }
}

function jsonObject(value: unknown): { [key: string]: JsonValue } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isJsonValue(item)) return null;
    parsed[key] = item;
  }
  return parsed;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}
