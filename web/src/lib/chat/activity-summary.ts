import type { TranscriptBlock } from "$lib/chat/types";

const COMPACT_ACTION_TYPE_LIMIT = 3;
const TOOL_REVEAL_DELAY_MS = 1_000;
const TOOL_COMPLETION_HOLD_MS = 2_000;

export type ToolPresentation = "hidden" | "visible" | "collapsible";

type ActivitySummary = {
    text: string;
    parts: string[];
    condensed: boolean;
};

export function toolPresentation(
    block: TranscriptBlock,
    now: number,
): ToolPresentation {
    if (block.kind !== "tool-call" && block.kind !== "tool-result") {
        return "visible";
    }

    const running =
        block.status === "streaming" ||
        block.status === "ready" ||
        block.status === "running";
    if (running) {
        return block.startedAt !== undefined &&
            now < block.startedAt + TOOL_REVEAL_DELAY_MS
            ? "hidden"
            : "visible";
    }

    const terminal =
        block.status === "completed" ||
        block.status === "error" ||
        block.status === "aborted" ||
        block.hasResult === true;
    if (!terminal) return "visible";

    if (
        block.startedAt !== undefined &&
        block.completedAt !== undefined
    ) {
        const runtime = block.completedAt - block.startedAt;
        if (runtime < TOOL_REVEAL_DELAY_MS) {
            return "collapsible";
        }
        if (now < block.completedAt + TOOL_COMPLETION_HOLD_MS) {
            return "visible";
        }
    }

    return "collapsible";
}

export function nextToolPresentationDeadline(
    block: TranscriptBlock,
    now: number,
): number | undefined {
    const presentation = toolPresentation(block, now);
    if (presentation === "hidden" && block.startedAt !== undefined) {
        return block.startedAt + TOOL_REVEAL_DELAY_MS;
    }
    if (presentation === "visible" && block.completedAt !== undefined) {
        const deadline = block.completedAt + TOOL_COMPLETION_HOLD_MS;
        return deadline > now ? deadline : undefined;
    }
    return undefined;
}

export function summarizeTerminalActivity(
    blocks: TranscriptBlock[],
    summarizeReasoning: (...texts: string[]) => string,
): ActivitySummary {
    const counts: Record<string, number> = {};
    const orderedKinds: string[] = [];
    const reasoningText: string[] = [];
    let summedToolDuration = 0;
    let startedAt: number | undefined;
    let completedAt: number | undefined;

    for (const block of blocks) {
        if (block.startedAt !== undefined) {
            startedAt =
                startedAt === undefined
                    ? block.startedAt
                    : Math.min(startedAt, block.startedAt);
        }
        if (block.completedAt !== undefined) {
            completedAt =
                completedAt === undefined
                    ? block.completedAt
                    : Math.max(completedAt, block.completedAt);
        }
        if (block.kind === "reasoning") {
            reasoningText.push(block.text);
            continue;
        }

        const kind = toolSummaryKind(block);
        if (!(kind in counts)) {
            orderedKinds.push(kind);
        }
        counts[kind] = (counts[kind] ?? 0) + 1;
        if (typeof block.duration === "number" && Number.isFinite(block.duration)) {
            summedToolDuration += Math.max(0, block.duration);
        }
    }

    const sortOrder: Record<string, number> = {
        "edit": 1,
        "file written": 2,
        "command": 3,
        "skill": 4,
        "session": 5,
        "MCP": 6,
        "file read": 7,
        "search": 8,
        "web request": 9,
        "image viewed": 10,
        "action": 11,
    };

    orderedKinds.sort((a, b) => (sortOrder[a] ?? 99) - (sortOrder[b] ?? 99));

    const toolParts = orderedKinds
        .slice(0, 3)
        .map((kind) => formatSummaryPart(kind, counts[kind]));

    return {
        text: toolParts.join(", "),
        parts: toolParts,
        condensed: orderedKinds.length > COMPACT_ACTION_TYPE_LIMIT,
    };
}

function toolSummaryKind(block: TranscriptBlock): string {
    if (block.originalToolName === "bash" || block.originalToolName === "execute_command") return "command";
    if (block.originalToolName === "read_file" || block.originalToolName === "view_file") return "file read";
    if (block.originalToolName === "view_image") return "image viewed";
    if (block.originalToolName === "write_file" || block.originalToolName === "create_file") return "file written";
    if (block.originalToolName === "apply_patch") return "edit";
    if (block.originalToolName === "search") return "search";
    if (block.originalToolName === "website" || block.originalToolName === "web_search" || block.originalToolName === "web_fetch") return "web request";
    if (block.originalToolName === "skill" || block.originalToolName === "load_skill") return "skill";
    if (block.originalToolName === "mcp") return "MCP";
    if (block.originalToolName === "list_sessions" || block.originalToolName === "inspect_session" || block.originalToolName === "start_session") return "session";
    return "action";
}

function formatSummaryPart(kind: string, count: number): string {
    if (kind === "command") return `Ran ${count} command${count === 1 ? "" : "s"}`;
    if (kind === "file read") return `Read ${count} file${count === 1 ? "" : "s"}`;
    if (kind === "image viewed") return `Viewed ${count} image${count === 1 ? "" : "s"}`;
    if (kind === "file written") return `Wrote ${count} file${count === 1 ? "" : "s"}`;
    if (kind === "edit") return `Edited ${count} file${count === 1 ? "" : "s"}`;
    if (kind === "search") return `Searched ${count} time${count === 1 ? "" : "s"}`;
    if (kind === "web request") return `Fetched ${count} web result${count === 1 ? "" : "s"}`;
    if (kind === "skill") return `Loaded ${count} skill${count === 1 ? "" : "s"}`;
    if (kind === "MCP") return `Used MCP ${count} time${count === 1 ? "" : "s"}`;
    if (kind === "session") return `Used ${count} session tool${count === 1 ? "" : "s"}`;
    return `${count} action${count === 1 ? "" : "s"}`;
}
