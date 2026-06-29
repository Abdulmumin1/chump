import type {
    MessagePart,
    StoredMessage,
    ToolCallMessagePart,
    ToolLifecycleStatus,
    ToolResultMessagePart,
} from "$lib/chump/types";
import { asArgsRecord, asRecord, asString } from "$lib/chat/helpers";

const TOOL_EVENT_TYPES = new Set([
    "tool_call.started",
    "tool_call.delta",
    "tool_call.ready",
    "tool_call",
    "tool_execution.started",
    "tool_execution.finished",
    "tool_result",
]);

type ToolIdentity = {
    callId: string;
    step?: number;
    index?: number;
    name: string;
};

type ToolCallLocation = {
    messageIndex: number;
    partIndex: number;
    part: ToolCallMessagePart;
};

export function isToolLifecycleEvent(type: string): boolean {
    return TOOL_EVENT_TYPES.has(type);
}

export function applyToolLifecycleEvent(
    source: StoredMessage[],
    type: string,
    data: Record<string, unknown>,
): StoredMessage[] {
    const identity = readIdentity(data);

    if (
        type === "tool_call.started" ||
        type === "tool_call.delta" ||
        type === "tool_call.ready" ||
        type === "tool_call"
    ) {
        return upsertToolCall(source, type, data, identity);
    }

    if (type === "tool_execution.started") {
        return updateToolCallStatus(source, identity, "running");
    }

    if (type === "tool_execution.finished") {
        const status = readResultStatus(data);
        const withStatus = updateToolCallStatus(
            source,
            identity,
            status,
            numberValue(data.duration),
        );
        return upsertToolResult(withStatus, data, identity, status);
    }

    if (type === "tool_result") {
        const status = readResultStatus(data);
        const withStatus = updateToolCallStatus(source, identity, status);
        return upsertToolResult(withStatus, data, identity, status);
    }

    return source;
}

function upsertToolCall(
    source: StoredMessage[],
    type: string,
    data: Record<string, unknown>,
    identity: ToolIdentity,
): StoredMessage[] {
    const location = findToolCall(
        source,
        identity,
        type === "tool_call.ready" || type === "tool_call",
    );
    const explicitArgsValue = data.args ?? data.payload ?? data.arguments;
    const explicitArgs =
        explicitArgsValue === undefined
            ? null
            : asArgsRecord(explicitArgsValue);
    const nameDelta = asString(data.name_delta);
    const argumentsDelta = asString(data.arguments_delta);
    const status: ToolLifecycleStatus =
        type === "tool_call.started" || type === "tool_call.delta"
            ? "streaming"
            : "ready";

    if (!location) {
        const argumentsText = argumentsDelta;
        const parsedArgs =
            explicitArgs ?? parseArguments(argumentsText) ?? {};
        return appendLiveAssistantPart(source, {
            type: "tool_call",
            tool_call: {
                id: identity.callId || syntheticCallId(identity),
                name: identity.name || nameDelta || "tool",
                arguments: parsedArgs,
                arguments_text: argumentsText || undefined,
                step: identity.step,
                index: identity.index,
                status,
            },
        });
    }

    return replaceToolCall(source, location, (current) => {
        const argumentsText = `${current.arguments_text ?? ""}${argumentsDelta}`;
        return {
            ...current,
            id: identity.callId || current.id,
            name:
                identity.name ||
                `${current.name === "tool" ? "" : current.name}${nameDelta}` ||
                "tool",
            arguments:
                explicitArgs ??
                parseArguments(argumentsText) ??
                current.arguments ??
                {},
            arguments_text: argumentsText || current.arguments_text,
            step: identity.step ?? current.step,
            index: identity.index ?? current.index,
            status,
        };
    });
}

function updateToolCallStatus(
    source: StoredMessage[],
    identity: ToolIdentity,
    status: ToolLifecycleStatus,
    duration?: number,
): StoredMessage[] {
    const location = findToolCall(source, identity);
    if (!location) {
        const created = upsertToolCall(
            source,
            "tool_call",
            {
                name: identity.name,
                call_id: identity.callId,
                step: identity.step,
                index: identity.index,
                status,
            },
            identity,
        );
        return updateToolCallStatus(created, identity, status, duration);
    }
    return replaceToolCall(source, location, (current) => ({
        ...current,
        id: identity.callId || current.id,
        name: identity.name || current.name,
        step: identity.step ?? current.step,
        index: identity.index ?? current.index,
        status,
        duration: duration ?? current.duration,
    }));
}

function upsertToolResult(
    source: StoredMessage[],
    data: Record<string, unknown>,
    identity: ToolIdentity,
    status: ToolLifecycleStatus,
): StoredMessage[] {
    const call = findToolCall(source, identity)?.part.tool_call;
    const callId = identity.callId || call?.id || syntheticCallId(identity);
    const result: ToolResultMessagePart = {
        type: "tool_result",
        tool_result: {
            tool_call_id: callId,
            tool_name: identity.name || call?.name || "tool",
            result: data.result ?? data.output ?? data.preview ?? "",
            is_error: status === "error" || status === "aborted",
            metadata: asRecord(data.metadata) ?? undefined,
            step: identity.step,
            index: identity.index,
            status,
            duration: numberValue(data.duration),
        },
    };
    const existing = findToolResult(source, callId, identity);
    if (!existing) {
        return [
            ...source,
            {
                role: "tool",
                content: [result],
                live: true,
            },
        ];
    }

    const next = [...source];
    const message = source[existing.messageIndex]!;
    const parts = [...(message.content as MessagePart[])];
    parts[existing.partIndex] = result;
    next[existing.messageIndex] = { ...message, content: parts };
    return next;
}

function findToolCall(
    source: StoredMessage[],
    identity: ToolIdentity,
    allowStreamingCallIdFallback = false,
): ToolCallLocation | null {
    const nameFallbacks: ToolCallLocation[] = [];
    let callIdFallback: ToolCallLocation | null = null;
    const hasPosition =
        identity.step !== undefined && identity.index !== undefined;
    for (let messageIndex = source.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = source[messageIndex]!;
        if (message.role === "user") break;
        if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
        for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = message.content[partIndex] as ToolCallMessagePart;
            if (part.type !== "tool_call") continue;
            const call = part.tool_call;
            if (
                allowStreamingCallIdFallback &&
                identity.callId &&
                call.id === identity.callId &&
                call.status === "streaming"
            ) {
                callIdFallback ??= { messageIndex, partIndex, part };
            }
            if (
                hasPosition &&
                call.step === identity.step &&
                call.index === identity.index
            ) {
                return { messageIndex, partIndex, part };
            }
            if (hasPosition) continue;
            if (identity.callId && call.id === identity.callId) {
                return { messageIndex, partIndex, part };
            }
            if (
                identity.name &&
                call.name === identity.name &&
                call.status !== "completed" &&
                call.status !== "error" &&
                call.status !== "aborted"
            ) {
                nameFallbacks.push({ messageIndex, partIndex, part });
            }
        }
    }
    if (callIdFallback) return callIdFallback;
    if (
        identity.callId || hasPosition
    ) {
        return null;
    }
    return nameFallbacks.length === 1 ? nameFallbacks[0]! : null;
}

function findToolResult(
    source: StoredMessage[],
    callId: string,
    identity: ToolIdentity,
): { messageIndex: number; partIndex: number } | null {
    const hasPosition =
        identity.step !== undefined && identity.index !== undefined;
    for (let messageIndex = source.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = source[messageIndex]!;
        if (message.role === "user") break;
        if (message.role !== "tool" || !Array.isArray(message.content)) continue;
        for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = message.content[partIndex] as ToolResultMessagePart;
            if (part.type !== "tool_result") continue;
            const result = part.tool_result;
            if (
                hasPosition &&
                result.step === identity.step &&
                result.index === identity.index
            ) {
                return { messageIndex, partIndex };
            }
            if (hasPosition) continue;
            if (callId && result.tool_call_id === callId) {
                return { messageIndex, partIndex };
            }
        }
    }
    return null;
}

function replaceToolCall(
    source: StoredMessage[],
    location: ToolCallLocation,
    update: (
        current: ToolCallMessagePart["tool_call"],
    ) => ToolCallMessagePart["tool_call"],
): StoredMessage[] {
    const next = [...source];
    const message = source[location.messageIndex]!;
    const parts = [...(message.content as MessagePart[])];
    parts[location.partIndex] = {
        ...location.part,
        tool_call: update(location.part.tool_call),
    };
    next[location.messageIndex] = { ...message, content: parts };
    return next;
}

function appendLiveAssistantPart(
    source: StoredMessage[],
    part: MessagePart,
): StoredMessage[] {
    const lastIndex = source.length - 1;
    const last = source[lastIndex];
    if (last?.live && last.role === "assistant" && Array.isArray(last.content)) {
        const next = [...source];
        next[lastIndex] = { ...last, content: [...last.content, part] };
        return next;
    }
    return [
        ...source,
        { role: "assistant", content: [part], live: true },
    ];
}

function readIdentity(data: Record<string, unknown>): ToolIdentity {
    return {
        callId:
            asString(data.call_id) ||
            asString(data.tool_call_id) ||
            asString(data.id),
        step: numberValue(data.step),
        index: numberValue(data.index),
        name:
            asString(data.name) ||
            asString(data.tool) ||
            asString(data.tool_name),
    };
}

function syntheticCallId(identity: ToolIdentity): string {
    return `live-tool:${identity.step ?? "unknown"}:${identity.index ?? "unknown"}`;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseArguments(value: string): Record<string, unknown> | null {
    if (!value) return null;
    try {
        return asArgsRecord(JSON.parse(value)) ?? null;
    } catch {
        return parsePartialJsonObject(value);
    }
}

function parsePartialJsonObject(value: string): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    let cursor = skipWhitespace(value, 0);
    if (value[cursor] !== "{") return null;
    cursor += 1;

    while (cursor < value.length) {
        cursor = skipWhitespaceAndCommas(value, cursor);
        if (value[cursor] !== '"') break;
        const key = readJsonString(value, cursor, false);
        if (!key.complete) break;
        cursor = skipWhitespace(value, key.end);
        if (value[cursor] !== ":") break;
        cursor = skipWhitespace(value, cursor + 1);
        if (value[cursor] !== '"') break;
        const field = readJsonString(value, cursor, true);
        result[key.value] = field.value;
        cursor = field.end;
        if (!field.complete) break;
    }

    return Object.keys(result).length > 0 ? result : null;
}

function readJsonString(
    source: string,
    start: number,
    allowPartial: boolean,
): { value: string; end: number; complete: boolean } {
    let value = "";
    let cursor = start + 1;
    while (cursor < source.length) {
        const character = source[cursor]!;
        if (character === '"') {
            return { value, end: cursor + 1, complete: true };
        }
        if (character !== "\\") {
            value += character;
            cursor += 1;
            continue;
        }

        const escaped = source[cursor + 1];
        if (escaped === undefined) break;
        const simpleEscapes: Record<string, string> = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
        };
        if (escaped === "u") {
            const hex = source.slice(cursor + 2, cursor + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
            value += String.fromCharCode(Number.parseInt(hex, 16));
            cursor += 6;
            continue;
        }
        value += simpleEscapes[escaped] ?? escaped;
        cursor += 2;
    }
    return {
        value: allowPartial ? value : "",
        end: source.length,
        complete: false,
    };
}

function skipWhitespace(source: string, start: number): number {
    let cursor = start;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    return cursor;
}

function skipWhitespaceAndCommas(source: string, start: number): number {
    let cursor = start;
    while (/\s|,/.test(source[cursor] ?? "")) cursor += 1;
    return cursor;
}

function readResultStatus(data: Record<string, unknown>): ToolLifecycleStatus {
    if (data.aborted === true || data.status === "aborted") return "aborted";
    if (
        data.ok === false ||
        data.is_error === true ||
        data.status === "error" ||
        Boolean(data.error)
    ) {
        return "error";
    }
    return "completed";
}
