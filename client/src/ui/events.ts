import {
  openEventStream,
} from "../api/sse.ts";
import { renderError } from "./render.ts";
import { TranscriptRenderer, transcriptEventFromSse } from "./transcript.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

let toolActivityHook: (() => void) | null = null;
let reasoningActivityHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringAcceptedHook: ((content: string) => void) | null = null;
let userMessageHook: ((payload: Record<string, unknown>) => boolean) | null = null;
let assistantTextHook: ((content: string) => boolean) | null = null;
let agentStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringQueueHook: ((payload: Record<string, unknown>) => void) | null = null;
let turnStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
const transcriptRenderer = new TranscriptRenderer({
  hooks: {
    onToolActivity: () => toolActivityHook?.(),
    onReasoningActivity: (payload) => reasoningActivityHook?.(payload),
    onSteeringAccepted: (content) => steeringAcceptedHook?.(content),
    onUserMessage: (payload) => userMessageHook?.(payload) ?? false,
    onAssistantText: (content) => assistantTextHook?.(content) ?? false,
    onAgentStatus: (payload) => agentStatusHook?.(payload),
    onSteeringQueue: (payload) => steeringQueueHook?.(payload),
    onTurnStatus: (payload) => turnStatusHook?.(payload),
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

export function setUserMessageHook(
  hook: ((payload: Record<string, unknown>) => boolean) | null,
): void {
  userMessageHook = hook;
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

export async function startEventStream(config: ChumpConfig): Promise<(() => void) | null> {
  try {
    return await openEventStream(config, {
      onEvent: (event) => logEvent(event),
      onError: (error) => console.error(renderError(`[events] ${error.message}`)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(renderError(`[events] ${message}`));
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
