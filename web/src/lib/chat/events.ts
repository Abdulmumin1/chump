import type {
    MessagePart,
    StoredEvent,
    StoredMessage,
} from "$lib/chump/types";
import type { SteeringQueueItem } from "$lib/chat/types";
import {
    asArgsRecord,
    asRecord,
    asString,
    buildUserMessageContentFromPayload,
} from "$lib/chat/helpers";
import { mergeReasoningText } from "$lib/chat/transcript";

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

export function applyLiveEventToMessages(
    source: StoredMessage[],
    type: string,
    data: Record<string, unknown> | null,
): StoredMessage[] {
    if (!data) return source;

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

    if (type === "tool_call") {
        const toolName = asString(data.name) || asString(data.tool) || "tool";
        const args = asArgsRecord(data.args ?? data.payload ?? data.arguments ?? {});
        const id =
            asString(data.id) ||
            asString(data.tool_call_id) ||
            `live-${Date.now()}`;
        const message = getOrCreateLiveAssistantMessage(next);
        (message.content as MessagePart[]).push({
            type: "tool_call",
            tool_call: { id, name: toolName, arguments: args ?? {} },
        });
        return [...next];
    }

    if (type === "tool_result") {
        const toolName =
            asString(data.name) ||
            asString(data.tool) ||
            asString(data.tool_name) ||
            "tool";
        const toolCallId = asString(data.tool_call_id) || asString(data.id) || "";
        const result = data.result ?? data.output ?? data.preview ?? "";
        const isError =
            data.ok === false ||
            data.status === "error" ||
            data.is_error === true;
        const metadata = asRecord(data.metadata);
        next.push({
            role: "tool",
            content: [
                {
                    type: "tool_result",
                    tool_result: {
                        tool_call_id: toolCallId,
                        tool_name: toolName,
                        result,
                        is_error: isError,
                        metadata: metadata ?? undefined,
                    },
                },
            ],
        });
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
