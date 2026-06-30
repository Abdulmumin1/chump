import type { ModelChoice } from "$lib/models";
import type { ToolLifecycleStatus } from "$lib/chump/types";

export type TranscriptBlock = {
    kind: "text" | "tool-call" | "tool-result" | "image" | "reasoning";
    text: string;
    error?: boolean;
    toolCallId?: string;
    toolName?: string;
    originalToolName?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    metadata?: Record<string, unknown>;
    hasResult?: boolean;
    status?: ToolLifecycleStatus;
    duration?: number;
    isDiff?: boolean;
    diffContent?: string;
    imageSrc?: string;
    mediaType?: string;
    label?: string;
    filename?: string;
};

export type TranscriptMessage = {
    id: string;
    role: string;
    label: string;
    blocks: TranscriptBlock[];
    live?: boolean;
};

export type SteeringQueueItem = {
    content: string;
    display_content?: string;
    attachments?: Array<Record<string, unknown>>;
};

export type ModelGroup = {
    provider: string;
    models: ModelChoice[];
};
