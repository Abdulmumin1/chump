import {
  openEventStream,
} from "../api/sse.ts";
import { TranscriptRenderer, transcriptEventFromSse } from "./transcript.ts";
import type { ChumpConfig, SseEvent } from "../core/types.ts";
import type { DelegatedSessionProgress } from "../core/delegated-session-progress.ts";

const DEBUG_EVENT_STREAM =
  process.env.CHUMP_DEBUG_EVENTS === "1" ||
  process.env.CHUMP_DEBUG_EVENTS === "true";

let eventStreamGeneration = 0;

let toolActivityHook: ((
  preview: string,
  payload: Record<string, unknown>,
) => void) | null = null;
let beforeToolActivityHook: (() => void) | null = null;
let toolCallStreamHook: ((
  preview: string | null,
  payload: Record<string, unknown>,
) => void) | null = null;
let toolResultHook: ((payload: Record<string, unknown>) => void) | null = null;
let reasoningActivityHook: ((payload: Record<string, unknown>) => void) | null = null;
let delegatedSessionProgressHook: ((progress: DelegatedSessionProgress) => void) | null = null;
let steeringAcceptedHook: ((content: string) => void) | null = null;
let assistantTextHook: ((content: string) => boolean) | null = null;
let agentStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
let steeringQueueHook: ((payload: Record<string, unknown>) => void) | null = null;
let turnStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
let compactionStatusHook: ((payload: Record<string, unknown>) => void) | null = null;
const transcriptRenderer = new TranscriptRenderer({
  hooks: {
    onBeforeToolActivity: () => beforeToolActivityHook?.(),
    onToolActivity: (preview, payload) => toolActivityHook?.(preview, payload),
    onToolCallStream: (preview, payload) =>
      toolCallStreamHook?.(preview, payload),
    onToolResult: (payload) => toolResultHook?.(payload),
    onReasoningActivity: (payload) => reasoningActivityHook?.(payload),
    onDelegatedSessionProgress: (progress) => delegatedSessionProgressHook?.(progress),
    onSteeringAccepted: (content) => steeringAcceptedHook?.(content),
    onAssistantText: (content) => assistantTextHook?.(content) ?? false,
    onAgentStatus: (payload) => agentStatusHook?.(payload),
    onSteeringQueue: (payload) => steeringQueueHook?.(payload),
    onTurnStatus: (payload) => turnStatusHook?.(payload),
    onCompactionStatus: (payload) => compactionStatusHook?.(payload),
  },
});

export function setBeforeToolActivityHook(hook: (() => void) | null): void {
  beforeToolActivityHook = hook;
}

export function setToolActivityHook(
  hook: ((preview: string, payload: Record<string, unknown>) => void) | null,
): void {
  toolActivityHook = hook;
}

export function setToolCallStreamHook(
  hook: ((
    preview: string | null,
    payload: Record<string, unknown>,
  ) => void) | null,
): void {
  toolCallStreamHook = hook;
}

export function setToolResultHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  toolResultHook = hook;
}

export function setReasoningActivityHook(
  hook: ((payload: Record<string, unknown>) => void) | null,
): void {
  reasoningActivityHook = hook;
}

export function setDelegatedSessionProgressHook(
  hook: ((progress: DelegatedSessionProgress) => void) | null,
): void {
  delegatedSessionProgressHook = hook;
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

export async function startEventStream(
  config: ChumpConfig,
  options: {
    lastEventId?: number;
    onLastEventId?: (eventId: number) => void;
    onConnectionError?: (error: Error) => void | Promise<void>;
  } = {},
): Promise<(() => void) | null> {
  const generation = ++eventStreamGeneration;
  transcriptRenderer.setWorkspaceRoot(config.workspaceRoot);
  try {
    const close = await openEventStream(config, {
      onEvent: (event) => {
        if (generation === eventStreamGeneration) {
          logEvent(event);
        }
      },
      onError: async (error) => {
        if (generation !== eventStreamGeneration) {
          return;
        }
        if (DEBUG_EVENT_STREAM) {
          console.error(`[events] ${error.message}; retrying`);
        }
        await options.onConnectionError?.(error);
      },
    }, {
      lastEventId: options.lastEventId,
      onLastEventId: (eventId) => {
        if (generation === eventStreamGeneration) {
          options.onLastEventId?.(eventId);
        }
      },
    });
    return () => {
      close();
      if (generation === eventStreamGeneration) {
        eventStreamGeneration += 1;
      }
    };
  } catch (error) {
    if (generation === eventStreamGeneration) {
      eventStreamGeneration += 1;
    }
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
