import {
  openEventStream,
} from "../api/sse.ts";
import { TranscriptRenderer, transcriptEventFromSse } from "./transcript.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

const DEBUG_EVENT_STREAM =
  process.env.CHUMP_DEBUG_EVENTS === "1" ||
  process.env.CHUMP_DEBUG_EVENTS === "true";

let toolActivityHook: (() => void) | null = null;
let reasoningActivityHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringAcceptedHook: ((content: string) => void) | null = null;
let assistantTextHook: ((content: string) => boolean) | null = null;
let agentStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringQueueHook: ((payload: Record<string, unknown>) => void) | null = null;
let turnStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
let compactionStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
const transcriptRenderer = new TranscriptRenderer({
  hooks: {
    onToolActivity: () => toolActivityHook?.(),
    onReasoningActivity: (payload) => reasoningActivityHook?.(payload),
    onSteeringAccepted: (content) => steeringAcceptedHook?.(content),
    onAssistantText: (content) => assistantTextHook?.(content) ?? false,
    onAgentStatus: (payload) => agentStatusHook?.(payload),
    onSteeringQueue: (payload) => steeringQueueHook?.(payload),
    onTurnStatus: (payload) => turnStatusHook?.(payload),
    onCompactionStatus: (payload) => compactionStatusHook?.(payload),
  },
});

export function setToolActivityHook(hook: (() => void) | null): void {
  toolActivityHook = hook;
}

export function setReasoningActivityHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  reasoningActivityHook = hook;
}

export function setSteeringAcceptedHook(hook: ((content: string) => void) | null): void {
  steeringAcceptedHook = hook;
}

export function setAssistantTextHook(
  hook: ((content: string) => boolean) | null,
): void {
  assistantTextHook = hook;
}

export function setAgentStatusHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  agentStatusHook = hook;
}

export function setSteeringQueueHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  steeringQueueHook = hook;
}

export function setTurnStatusHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  turnStatusHook = hook;
}

export function setCompactionStatusHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  compactionStatusHook = hook;
}

export async function startEventStream(config: ChumpConfig): Promise<(() => void) | null> {
  try {
    return await openEventStream(config, {
      onEvent: (event) => logEvent(event),
      onError: (error) => {
        if (DEBUG_EVENT_STREAM) {
          console.error(`[events] ${error.message}; retrying`);
        }
      },
    });
  } catch (error) {
    if (DEBUG_EVENT_STREAM) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[events] ${message}`);
    }
    return null;
  }
}

function logEvent(event: SseEvent): void {
  const transcriptEvent = transcriptEventFromSse(event);
  if (transcriptEvent) {
    transcriptRenderer.render(transcriptEvent);
  }
}

export function consumeToolActivity(): boolean {
  return transcriptRenderer.consumeToolActivity();
}
