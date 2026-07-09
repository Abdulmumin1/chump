import type {
    MessagePart,
    StoredEvent,
    StoredMessage,
} from "$lib/chump/types";
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
): StoredMessage[] {
    if (!data) return source;

    if (isToolLifecycleEvent(type)) {
        return applyToolLifecycleEvent(source, type, data);
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
            (last as { text: string }).text = mergeReasoningText(
                asString((last as Record<string, unknown>).text),
                fragment,
            );
        } else {
            parts.push({ type: "reasoning", text: fragment });
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
        next = applyLiveEventToMessages(next, event.type, event.data);
    }
    return next;
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
