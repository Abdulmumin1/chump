import type { ChatAttachment } from "$lib/chump/types";
import { uploadAttachment, type ChumpApiTarget } from "$lib/chump/api";

export async function uploadFilesAsAttachments(
    target: ChumpApiTarget,
    files: Iterable<File>,
): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];
    for (const file of files) {
        try {
            attachments.push(await uploadAttachment(target, file));
        } catch {
            // Keep the usable uploads when one file fails.
        }
    }
    return attachments;
}

export async function uploadClipboardItemsAsAttachments(
    target: ChumpApiTarget,
    items: Iterable<DataTransferItem>,
): Promise<ChatAttachment[]> {
    const files: File[] = [];
    for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        const extension = clipboardFileExtension(file);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        files.push(
            new File(
                [file],
                `clipboard-${timestamp}-${crypto.randomUUID().slice(0, 8)}${extension}`,
                { type: file.type, lastModified: file.lastModified },
            ),
        );
    }
    return await uploadFilesAsAttachments(target, files);
}

function clipboardFileExtension(file: File): string {
    const extension = /\.[a-z0-9]+$/i.exec(file.name)?.[0];
    if (extension) return extension.toLowerCase();
    if (file.type === "image/jpeg") return ".jpg";
    if (file.type === "image/webp") return ".webp";
    if (file.type === "image/gif") return ".gif";
    if (file.type === "image/png") return ".png";
    return "";
}
