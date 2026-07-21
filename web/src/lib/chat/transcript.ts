import type { MessagePart, StoredMessage } from "$lib/chump/types";
import type { TranscriptBlock, TranscriptMessage } from "$lib/chat/types";
import {
    asArgsRecord,
    asRecord,
    asString,
    hasDiffMetadata,
    stringifyValue,
} from "$lib/chat/helpers";

export function buildTranscript(source: StoredMessage[]): TranscriptMessage[] {
    const items: TranscriptMessage[] = [];

    for (let index = 0; index < source.length; index += 1) {
        const message = source[index]!;

        if (message.role === "assistant" && Array.isArray(message.content)) {
            let reasoningBuffer = "";
            const nonReasoningBlocks: TranscriptBlock[] = [];

            for (const part of message.content as MessagePart[]) {
                const candidate = part as Record<string, unknown>;
                if (candidate.type === "reasoning") {
                    const fragment = asString(candidate.text);
                    if (fragment) {
                        reasoningBuffer = mergeReasoningText(
                            reasoningBuffer,
                            fragment,
                        );
                    }
                    continue;
                }

                if (reasoningBuffer) {
                    pushReasoningMessage(
                        items,
                        index,
                        reasoningBuffer,
                        Boolean((message as { live?: boolean }).live),
                    );
                    reasoningBuffer = "";
                }

                nonReasoningBlocks.push(formatPartBlock(part));
            }

            if (reasoningBuffer) {
                pushReasoningMessage(
                    items,
                    index,
                    reasoningBuffer,
                    Boolean((message as { live?: boolean }).live),
                );
            }

            if (nonReasoningBlocks.length > 0) {
                items.push({
                    id: `${index}-assistant`,
                    role: "assistant",
                    label: "Assistant",
                    blocks: nonReasoningBlocks,
                    live: (message as { live?: boolean }).live,
                });
            }
            continue;
        }

        let blocks = formatMessageBlocks(message.content);

        if (message.role === "tool" || message.role === "user") {
            let allMerged = true;

            for (const block of blocks) {
                if (block.kind === "tool-result") {
                    let found = false;

                    for (
                        let itemIndex = items.length - 1;
                        itemIndex >= 0;
                        itemIndex -= 1
                    ) {
                        const item = items[itemIndex]!;
                        for (
                            let blockIndex = item.blocks.length - 1;
                            blockIndex >= 0;
                            blockIndex -= 1
                        ) {
                            const parentBlock = item.blocks[blockIndex]!;
                            if (block.toolCallId) {
                                if (
                                    parentBlock.kind === "tool-call" &&
                                    !parentBlock.hasResult &&
                                    parentBlock.toolCallId === block.toolCallId
                                ) {
                                    mergeToolResultIntoCall(parentBlock, block);
                                    found = true;
                                    break;
                                }
                            } else if (
                                parentBlock.kind === "tool-call" &&
                                !parentBlock.hasResult &&
                                parentBlock.originalToolName === block.originalToolName
                            ) {
                                mergeToolResultIntoCall(parentBlock, block);
                                found = true;
                                break;
                            }
                        }

                        if (found) break;
                    }

                    if (!found) {
                        allMerged = false;
                    } else {
                        block.hasResult = true;
                    }
                } else {
                    allMerged = false;
                }
            }

            blocks = blocks.filter((block) => !block.hasResult);
            if (blocks.length === 0 && allMerged) {
                continue;
            }
        }

        items.push({
            id: `${index}-${message.role}`,
            role: message.role,
            label: formatRole(message.role),
            blocks,
            live: (message as { live?: boolean }).live,
        });
    }

    return items;
}

export function mergeReasoningText(existing: string, incoming: string): string {
    const normalized = normalizeReasoningChunk(incoming, existing.length === 0);
    if (!normalized.trim()) {
        return existing;
    }

    const appended = appendNovelSuffix(existing, normalized);
    if (!appended) {
        return existing;
    }

    return existing + appended;
}

export function reasoningSummary(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(1, Math.round(words / 35));
    return `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`;
}

function pushReasoningMessage(
    items: TranscriptMessage[],
    index: number,
    reasoningBuffer: string,
    live: boolean,
): void {
    const text = cleanReasoningText(reasoningBuffer);
    if (!text) {
        return;
    }

    items.push({
        id: `${index}-reasoning-${items.length}`,
        role: "reasoning",
        label: "Reasoning",
        blocks: [{ kind: "reasoning", text }],
        live,
    });
}

function mergeToolResultIntoCall(
    parentBlock: TranscriptBlock,
    block: TranscriptBlock,
): void {
    parentBlock.result = block.result;
    parentBlock.error = block.error;
    parentBlock.status = block.status;
    parentBlock.duration = block.duration ?? parentBlock.duration;
    if (block.metadata) {
        parentBlock.metadata = block.metadata;
        parentBlock.isDiff =
            parentBlock.isDiff || hasDiffMetadata(block.metadata);
    }
    parentBlock.hasResult = true;
}

function normalizeReasoningChunk(value: string, trimStart: boolean): string {
    const normalized = value
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n");
    return trimStart ? normalized.trimStart() : normalized;
}

function appendNovelSuffix(existing: string, incoming: string): string {
    if (!incoming) return "";
    if (!existing) return incoming;
    if (existing.endsWith(incoming)) return "";
    if (incoming.startsWith(existing)) {
        return incoming.slice(existing.length);
    }

    const tail = existing.slice(-Math.min(existing.length, incoming.length, 1024));
    const maxOverlap = Math.min(tail.length, incoming.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        if (tail.slice(-overlap) === incoming.slice(0, overlap)) {
            return incoming.slice(overlap);
        }
    }

    return incoming;
}

function cleanReasoningText(value: string): string {
    const normalized = value
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!normalized) return "";

    return normalized
        .split("\n")
        .map((line) => dedupeAdjacentWords(line))
        .join("\n");
}

function dedupeAdjacentWords(value: string): string {
    const words = value.split(" ");
    const cleaned: string[] = [];

    for (const word of words) {
        const previous = cleaned[cleaned.length - 1];
        if (previous && stripWord(previous) === stripWord(word)) {
            continue;
        }
        cleaned.push(word);
    }

    return cleaned.join(" ");
}

function stripWord(value: string): string {
    return value.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
}

function formatMessageBlocks(content: StoredMessage["content"]): TranscriptBlock[] {
    if (typeof content === "string") {
        return [
            {
                kind: "text",
                text: skillCommandDisplayFromPrompt(content) ?? content,
            },
        ];
    }

    const blocks = (content as MessagePart[]).map(formatPartBlock);
    return blocks.length > 0 ? blocks : [{ kind: "text", text: "" }];
}

export function skillCommandDisplayFromPrompt(value: string): string | null {
    const match = /^<skill_content name="([a-z0-9-]+)">\n/.exec(value);
    if (!match) return null;

    const closing = "\n</skill_content>";
    const closingIndex = value.lastIndexOf(closing);
    if (closingIndex < match[0].length) return null;

    const suffix = value.slice(closingIndex + closing.length).trim();
    if (suffix && !suffix.startsWith("User:")) return null;

    const args = suffix.slice("User:".length).trim();
    return `/skill:${match[1]}${args ? ` ${args}` : ""}`;
}

function formatPartBlock(part: MessagePart): TranscriptBlock {
    const candidate = part as Record<string, unknown>;
    const kind = typeof candidate.type === "string" ? candidate.type : "";

    if (kind === "text") {
        return { kind: "text", text: asString(candidate.text) };
    }

    if (kind === "tool_call") {
        const toolCall = asRecord(candidate.tool_call);
        let args = asArgsRecord(toolCall?.arguments ?? {});
        const toolName = asString(toolCall?.name) || "tool";
        if (isSkillTool(toolName)) {
            args = normalizeSkillArgs(args);
        }
        let isDiff = false;
        let diffContent = "";
        let headerTitle = toolName;

        if (toolName === "bash" || toolName === "execute_command") {
            const command = asString(args.command) || asString(args.cmd) || "";
            if (command) headerTitle = `$ ${command}`;
        } else if (
            toolName === "read_file" ||
            toolName === "view_file" ||
            toolName === "view_image"
        ) {
            const file = asString(args.file_path) || asString(args.path) || "";
            if (file) headerTitle = file.split("/").pop() || file;
        } else if (
            toolName === "edit_file" ||
            toolName === "apply_patch" ||
            toolName === "write_file" ||
            toolName === "create_file"
        ) {
            const file = asString(args.file_path) || asString(args.path) || "";
            if (file) headerTitle = file.split("/").pop() || file;
        } else if (toolName === "skill" || toolName === "load_skill") {
            const name = asString(args.name) || "";
            if (name) headerTitle = `Skill ${skillDisplayName(name)}`;
        } else if (toolName === "list_sessions") {
            headerTitle = "List sessions";
        } else if (toolName === "inspect_session") {
            const sessionId = asString(args.session_id) || "";
            headerTitle = sessionId ? `Inspect ${sessionId}` : "Inspect session";
        } else if (toolName === "start_session") {
            const sessionId = asString(args.session_id) || "";
            headerTitle = sessionId ? `Start ${sessionId}` : "Start session";
        }

        if (
            typeof args.patch === "string" ||
            typeof args.patchText === "string" ||
            typeof args.patch_text === "string" ||
            typeof args.diff === "string" ||
            typeof args.file_diff === "string"
        ) {
            isDiff = true;
            diffContent = (args.patch ||
                args.patchText ||
                args.patch_text ||
                args.diff ||
                args.file_diff) as string;
        } else if (
            typeof args.content === "string" &&
            (toolName === "write_file" || toolName === "create_file")
        ) {
            isDiff = true;
            diffContent =
                `+++ ${headerTitle}\n@@ -0,0 +1 @@\n` +
                args.content
                    .split("\n")
                    .map((line) => `+${line}`)
                    .join("\n");
        }

        return {
            kind: "tool-call",
            text: `${toolName}\n${stringifyValue(args)}`,
            toolCallId: asString(toolCall?.id),
            toolName: headerTitle,
            originalToolName: toolName,
            args: args ?? undefined,
            status: toolCall?.status as TranscriptBlock["status"],
            duration:
                typeof toolCall?.duration === "number"
                    ? toolCall.duration
                    : undefined,
            isDiff,
            diffContent,
        };
    }

    if (kind === "tool_result") {
        const toolResult = asRecord(candidate.tool_result);
        const toolName = asString(toolResult?.tool_name) || "tool";
        const result = isSkillTool(toolName)
            ? loadedSkillPreview(toolResult?.result)
            : toolResult?.result;
        return {
            kind: "tool-result",
            toolCallId: asString(toolResult?.tool_call_id),
            text: stringifyValue(result),
            error: toolResult?.is_error === true,
            result,
            metadata: asRecord(toolResult?.metadata) ?? undefined,
            status: toolResult?.status as TranscriptBlock["status"],
            duration:
                typeof toolResult?.duration === "number"
                    ? toolResult.duration
                    : undefined,
            toolName,
            originalToolName: toolName,
        };
    }

    if (kind === "image") {
        const mediaType = asString(candidate.media_type);
        const imageSrc = asString(candidate.image);
        const filename = asString(candidate.filename);
        const label = asString(candidate.label);
        return {
            kind: "image",
            text: label || filename || (mediaType ? `image · ${mediaType}` : "image"),
            imageSrc: imageSrc || undefined,
            mediaType: mediaType || undefined,
            filename: filename || undefined,
            label: label || undefined,
        };
    }

    return { kind: "text", text: stringifyValue(part) };
}

function isSkillTool(toolName: string): boolean {
    return toolName === "skill" || toolName === "load_skill";
}

function skillDisplayName(value: string): string {
    const match = /<skill_content\s+name=["']([^"']+)["']/.exec(value);
    return match?.[1]?.trim() || value;
}

function normalizeSkillArgs(args: Record<string, unknown>): Record<string, unknown> {
    const rawName = asString(args.name);
    const displayName = skillDisplayName(rawName);
    return displayName === rawName ? args : { ...args, name: displayName };
}

function loadedSkillPreview(value: unknown): string {
    const raw = asString(value);
    const name = skillDisplayName(raw);
    return name && name !== raw ? `Loaded skill: ${name}` : "Loaded skill.";
}

function formatRole(role: string): string {
    if (role === "assistant") {
        return "Assistant";
    }
    if (role === "user") {
        return "You";
    }
    if (role === "tool") {
        return "Tool";
    }
    return role.charAt(0).toUpperCase() + role.slice(1);
}
