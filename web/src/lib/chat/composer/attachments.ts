import type { ChatAttachment } from "$lib/chump/types";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
};

export const ACCEPTED_IMAGE_TYPES =
    "image/png,image/jpeg,image/webp,image/gif";

export async function readFilesAsAttachments(
    files: Iterable<File>,
): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];

    for (const file of files) {
        if (
            file.type.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif)$/i.test(file.name)
        ) {
            try {
                attachments.push(await fileToAttachment(file));
            } catch {
                // Skip files that fail to read.
            }
        }
    }

    return attachments;
}

export async function readClipboardItemsAsAttachments(
    items: Iterable<DataTransferItem>,
): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];

    for (const item of items) {
        if (!item.type.startsWith("image/")) {
            continue;
        }

        const blob = item.getAsFile();
        if (!blob) {
            continue;
        }

        const filename = `clipboard${clipboardExtension(item.type)}`;
        try {
            attachments.push(await blobToAttachment(blob, filename));
        } catch {
            // Skip clipboard entries that fail to read.
        }
    }

    return attachments;
}

export function attachmentThumbSrc(attachment: ChatAttachment): string {
    return `data:${attachment.mime};base64,${attachment.data}`;
}

function fileToAttachment(file: File): Promise<ChatAttachment> {
    return new Promise((resolve, reject) => {
        const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "png");
        const mime = IMAGE_MIME_BY_EXTENSION[ext] ?? file.type ?? "image/png";
        const reader = new FileReader();

        reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(",")[1] ?? "";
            resolve({
                type: "image",
                label: `[Image: ${file.name}]`,
                filename: file.name,
                mime,
                data: base64,
            });
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function blobToAttachment(blob: Blob, filename: string): Promise<ChatAttachment> {
    const ext = "." + (filename.split(".").pop()?.toLowerCase() ?? "png");
    const mime = IMAGE_MIME_BY_EXTENSION[ext] ?? blob.type ?? "image/png";

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(",")[1] ?? "";
            resolve({
                type: "image",
                label: `[Image: ${filename}]`,
                filename,
                mime,
                data: base64,
            });
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function clipboardExtension(mimeType: string): string {
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return ".png";
}
