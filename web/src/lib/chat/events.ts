import type {
    MessagePart,
    StoredEvent,
    StoredMessage,
} from "$lib/chump/types";
import {
    isChumpEventType,
    parseChumpEvent,
} from "$lib/chump/events";
import type { SteeringQueueItem } from "$lib/chat/types";
import {
    asString,
    buildUserMessageContentFromPayload,
} from "$lib/chat/helpers";
import { mergeReasoningText } from "$lib/chat/transcript";
import {
    applyToolLifecycleEvent,
    isToolLifecycleEvent,
} from "$lib/chat/tool-events";

export function parseSteeringQueue(
    payload: Record<string, unknown>,
): SteeringQueueItem[] {
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
        .filter(
            (item): item is Record<string, unknown> =>
                Boolean(item && typeof item === "object"),
        )
        .map((item) => ({
            content: asString(item.content),
            display_content: asString(item.display_content) || undefined,
            attachments: Array.isArray(item.attachments)
                ? item.attachments.filter(
                      (
                          attachment,
                      ): attachment is Record<string, unknown> =>
                          Boolean(attachment && typeof attachment === "object"),
                  )
                : [],
        }))
        .filter(
            (item) =>
                item.display_content?.trim() ||
                item.content.trim() ||
                (item.attachments?.length ?? 0) > 0,
        );
}

export function removeSteeredQueueItem(
    queue: SteeringQueueItem[],
    payload: Record<string, unknown> | null,
): SteeringQueueItem[] {
    if (!payload || payload.steered !== true) {
        return queue;
    }
    const content = (
        asString(payload.display_content) || asString(payload.content)
    ).trim();
    if (!content) {
        return queue;
    }
    const index = queue.findIndex(
        (item) =>
            (item.display_content?.trim() || item.content.trim()) === content,
    );
    if (index === -1) {
        return queue;
    }
    return [...queue.slice(0, index), ...queue.slice(index + 1)];
}

export function applyLiveEventToMessages(
    source: StoredMessage[],
    type: string,
    data: Record<string, unknown> | null,
    occurredAt?: number,
    observedAt?: number,
): StoredMessage[] {
    if (!data) return source;
    const chumpEvent = parseChumpEvent(type, data);
    if (isChumpEventType(type) && !chumpEvent) return source;
    data = chumpEvent?.data ?? data;

    if (isToolLifecycleEvent(type)) {
        return applyToolLifecycleEvent(
            source,
            type,
            data,
            occurredAt,
            observedAt,
        );
    }

    const next = [...source];

    if (type === "user_message") {
        const content = buildUserMessageContentFromPayload(data);
        if (content) {
            next.push({ role: "user", content });
        }
        return next;
    }

    if (type === "reasoning") {
        const fragment = asString(data.text);
        if (!fragment) return next;
        const message = getOrCreateLiveAssistantMessage(next);
        const parts = message.content as MessagePart[];
        const last = parts.at(-1) as MessagePart | undefined;
        if (last && (last as Record<string, unknown>).type === "reasoning") {
            const reasoning = last as {
                text: string;
                data?: Record<string, unknown>;
            };
            reasoning.text = mergeReasoningText(
                asString(reasoning.text),
                fragment,
            );
            if (occurredAt !== undefined) {
                reasoning.data = {
                    ...reasoning.data,
                    presentation_started_at:
                        reasoning.data?.presentation_started_at ?? occurredAt,
                    presentation_completed_at: occurredAt,
                };
            }
        } else {
            parts.push({
                type: "reasoning",
                text: fragment,
                data:
                    occurredAt === undefined
                        ? undefined
                        : {
                              presentation_started_at: occurredAt,
                              presentation_completed_at: occurredAt,
                          },
            });
        }
        return [...next];
    }

    if (type === "assistant_text") {
        const chunk = asString(data.content);
        if (!chunk) return next;
        const message = getOrCreateLiveAssistantMessage(next);
        const parts = message.content as MessagePart[];
        const last = parts.at(-1) as MessagePart | undefined;
        if (last && (last as Record<string, unknown>).type === "text") {
            (last as { text: string }).text += chunk;
        } else {
            parts.push({ type: "text", text: chunk });
        }
        return [...next];
    }

    return next;
}

export function buildMessagesFromEventLog(events: StoredEvent[]): StoredMessage[] {
    let next: StoredMessage[] = [];
    for (const event of events) {
        next = applyLiveEventToMessages(
            next,
            event.type,
            event.data,
            eventTimestampMilliseconds(event.data),
        );
    }
    return next;
}

export function applyActivityTimingsFromEventLog(
    messages: StoredMessage[],
    events: StoredEvent[],
): StoredMessage[] {
    const timings = new Map<
        string,
        { startedAt?: number; completedAt?: number }
    >();

    for (const event of events) {
        const callId =
            asString(event.data.call_id) ||
            asString(event.data.tool_call_id) ||
            asString(event.data.id);
        const occurredAt = eventTimestampMilliseconds(event.data);
        if (!callId || occurredAt === undefined) continue;

        const timing = timings.get(callId) ?? {};
        if (
            event.type === "tool_call.started" ||
            event.type === "tool_call.delta" ||
            event.type === "tool_call.ready" ||
            event.type === "tool_call" ||
            event.type === "tool_execution.started"
        ) {
            timing.startedAt =
                timing.startedAt === undefined
                    ? occurredAt
                    : Math.min(timing.startedAt, occurredAt);
        }
        if (
            event.type === "tool_execution.finished" ||
            event.type === "tool_result"
        ) {
            timing.completedAt =
                timing.completedAt === undefined
                    ? occurredAt
                    : Math.max(timing.completedAt, occurredAt);
        }
        timings.set(callId, timing);
    }

    if (timings.size === 0) return messages;

    return messages.map((message) => {
        if (!Array.isArray(message.content)) return message;

        const content = message.content.map((part) => {
            const candidate = part as Record<string, unknown>;
            if (candidate.type === "tool_call") {
                const toolCall = candidate.tool_call as
                    | Record<string, unknown>
                    | undefined;
                const timing = timings.get(asString(toolCall?.id));
                if (!toolCall || !timing) return part;
                return {
                    ...part,
                    tool_call: {
                        ...toolCall,
                        presentation_started_at: timing.startedAt,
                        presentation_completed_at: timing.completedAt,
                    },
                };
            }
            if (candidate.type === "tool_result") {
                const toolResult = candidate.tool_result as
                    | Record<string, unknown>
                    | undefined;
                const timing = timings.get(
                    asString(toolResult?.tool_call_id),
                );
                if (!toolResult || !timing) return part;
                return {
                    ...part,
                    tool_result: {
                        ...toolResult,
                        presentation_started_at: timing.startedAt,
                        presentation_completed_at: timing.completedAt,
                    },
                };
            }
            return part;
        }) as MessagePart[];

        return { ...message, content };
    });
}

export function eventTimestampMilliseconds(
    data: Record<string, unknown> | null,
): number | undefined {
    const createdAt = data?.created_at;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
        return undefined;
    }
    return createdAt * 1000;
}

function getOrCreateLiveAssistantMessage(
    source: StoredMessage[],
): StoredMessage & { live: true } {
    const last = source.at(-1) as (StoredMessage & { live?: boolean }) | undefined;
    if (last?.live && last.role === "assistant") {
        return last as StoredMessage & { live: true };
    }

    const message = {
        role: "assistant",
        content: [] as MessagePart[],
        live: true as const,
    };
    source.push(message);
    return message;
}
