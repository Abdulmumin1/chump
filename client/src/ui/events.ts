import {
  openEventStream,
} from "../api/sse.ts";
import { renderError } from "./render.ts";
import { TranscriptRenderer, transcriptEventFromSse } from "./transcript.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";

// The event stream is expected to fail while the machine is asleep or offline.
// Keep retrying, but avoid filling the terminal with identical transient errors
// during long sleep/network outage windows.
const EVENT_ERROR_LOG_INTERVAL_MS = 10 * 60 * 1000;

let toolActivityHook: (() => void) | null = null;
let reasoningActivityHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringAcceptedHook: ((content: string) => void) | null = null;
let userMessageHook: ((payload: Record<string, unknown>) => boolean) | null = null;
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
    onUserMessage: (payload) => userMessageHook?.(payload) ?? false,
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

export function setCompactionStatusHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  compactionStatusHook = hook;
}

export async function startEventStream(config: ChumpConfig): Promise<(() => void) | null> {
  let lastEventErrorMessage = "";
  let lastEventErrorAt = 0;
  let suppressedEventErrors = 0;

  try {
    return await openEventStream(config, {
      onEvent: (event) => {
        lastEventErrorMessage = "";
        lastEventErrorAt = 0;
        suppressedEventErrors = 0;
        logEvent(event);
      },
      onError: (error) => {
        const now = Date.now();
        const message = error.message || String(error);
        const shouldLog =
          message !== lastEventErrorMessage ||
          now - lastEventErrorAt >= EVENT_ERROR_LOG_INTERVAL_MS;

        if (!shouldLog) {
          suppressedEventErrors += 1;
          return;
        }

        const repeatSuffix =
          suppressedEventErrors > 0
            ? ` (${suppressedEventErrors} repeats suppressed)`
            : "";
        console.error(renderError(`[events] ${message}${repeatSuffix}; retrying`));
        lastEventErrorMessage = message;
        lastEventErrorAt = now;
        suppressedEventErrors = 0;
      },
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
