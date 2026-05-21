import type { MessagePart, StoredMessage } from "$lib/chump/types";

export function parseJson(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

export function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}

export function asArgsRecord(value: unknown): Record<string, unknown> {
    const direct = asRecord(value);
    if (direct) {
        return direct;
    }

    if (typeof value === "string") {
        const parsed = parseJson(value);
        if (parsed) {
            return parsed;
        }
    }

    return {};
}

export function stringifyValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function formatDate(value: number | null): string {
    if (!value) {
        return "—";
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(value * 1000);
}

export function shortenWorkspacePath(path: string): string {
    if (!path) return "";
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function shortenModel(name: string): string {
    return name.replace(/^workers_ai\/@cf\//, "").replace(/^@cf\//, "");
}

export function hasDiffMetadata(
    metadata: Record<string, unknown> | undefined,
): boolean {
    if (!metadata) return false;
    if (Array.isArray(metadata.files) && metadata.files.length > 0) {
        return true;
    }
    return Boolean(metadata.diff && typeof metadata.diff === "object");
}

export function attachmentSummaryLabel(
    attachment: Record<string, unknown>,
): string {
    const label = asString(attachment.label).trim();
    if (label) {
        return label;
    }

    const filename = asString(attachment.filename).trim();
    if (filename) {
        return `[Image: ${filename}]`;
    }

    const mime = asString(attachment.mime).trim();
    return mime ? `[Image · ${mime}]` : "[Image]";
}

export function imageAttachmentSummaryPart(
    attachment: Record<string, unknown>,
): MessagePart {
    const mime = asString(attachment.mime);
    const filename = asString(attachment.filename);
    const label = attachmentSummaryLabel(attachment);

    return {
        type: "image",
        media_type: mime || undefined,
        filename: filename || undefined,
        label: label || undefined,
    };
}

export function buildUserMessageContentFromPayload(
    payload: Record<string, unknown>,
): StoredMessage["content"] {
    const text = asString(payload.display_content) || asString(payload.content);
    const attachments = Array.isArray(payload.attachments)
        ? payload.attachments.filter(
              (attachment): attachment is Record<string, unknown> =>
                  Boolean(attachment && typeof attachment === "object"),
          )
        : [];

    if (attachments.length === 0) {
        return text;
    }

    const imageAttachments = attachments.filter(
        (attachment) => attachment.type === "image",
    );
    if (imageAttachments.length === 0) {
        return text;
    }

    const parts: MessagePart[] = [];
    let remaining = text;
    const used = new Set<number>();

    while (remaining) {
        let nextMatch:
            | {
                  position: number;
                  index: number;
                  attachment: Record<string, unknown>;
                  label: string;
              }
            | null = null;

        for (const [index, attachment] of imageAttachments.entries()) {
            if (used.has(index)) continue;
            const label = attachmentSummaryLabel(attachment);
            if (!label) continue;
            const position = remaining.indexOf(label);
            if (position === -1) continue;
            if (!nextMatch || position < nextMatch.position) {
                nextMatch = { position, index, attachment, label };
            }
        }

        if (!nextMatch) {
            pushTextPart(parts, remaining);
            remaining = "";
            break;
        }

        pushTextPart(parts, remaining.slice(0, nextMatch.position));
        parts.push(imageAttachmentSummaryPart(nextMatch.attachment));
        used.add(nextMatch.index);
        remaining = remaining.slice(nextMatch.position + nextMatch.label.length);
    }

    for (const [index, attachment] of imageAttachments.entries()) {
        if (!used.has(index)) {
            parts.push(imageAttachmentSummaryPart(attachment));
        }
    }

    return parts.length > 0 ? parts : text;
}

function pushTextPart(parts: MessagePart[], text: string): void {
    if (!text) return;
    parts.push({ type: "text", text });
}
