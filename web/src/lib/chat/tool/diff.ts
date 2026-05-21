import type { TranscriptBlock } from "$lib/chat/types";

export type StructuredDiffChange = {
    type: "add" | "remove";
    oldLine: number | null;
    newLine: number | null;
    text: string;
};

export type StructuredDiff = {
    path: string;
    kind?: "add" | "update" | "delete" | "move";
    sourcePath?: string | null;
    added: number;
    removed: number;
    changes?: StructuredDiffChange[];
    lines?: string[];
    truncated: boolean;
    shownChanges?: number;
    totalChanges?: number;
};

export type StructuredDiffRow = {
    kind: "add" | "remove" | "context" | "meta";
    oldLine: number | null;
    newLine: number | null;
    text: string;
};

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

export function readStructuredDiffs(
    metadata: Record<string, unknown> | undefined,
): StructuredDiff[] {
    if (!metadata) return [];
    const files = Array.isArray(metadata.files)
        ? metadata.files
              .map(readStructuredDiff)
              .filter((diff): diff is StructuredDiff => diff !== null)
        : [];
    if (files.length > 0) return files;
    const diff = readStructuredDiff(metadata.diff);
    return diff ? [diff] : [];
}

export function buildStructuredDiffRows(diff: StructuredDiff): StructuredDiffRow[] {
    if (diff.lines && diff.lines.length > 0) {
        return buildStructuredRowsFromLines(diff.lines);
    }

    return (diff.changes ?? []).map((change) => ({
        kind: change.type,
        oldLine: change.oldLine,
        newLine: change.newLine,
        text: change.text.length > 0 ? change.text : " ",
    }));
}

export function normalizeToolDiffPatch(block: TranscriptBlock): string {
    const toolName = String(block.originalToolName ?? "");
    const args = block.args ?? {};
    const directPatch =
        typeof block.diffContent === "string" && block.diffContent
            ? block.diffContent
            : extractStringField(args, [
                  "patch",
                  "patchText",
                  "patch_text",
                  "diff",
                  "file_diff",
              ]);

    if (
        !directPatch &&
        !["apply_patch", "write_file", "create_file"].includes(toolName)
    ) {
        return "";
    }

    if (
        (toolName === "write_file" || toolName === "create_file") &&
        typeof args.content === "string"
    ) {
        const fileName = String(
            args.file_path ?? args.path ?? block.toolName ?? "file",
        );
        return normalizeUnifiedPatchForRenderer(
            makeSyntheticWritePatch(fileName, args.content),
        );
    }

    if (toolName === "apply_patch" && directPatch) {
        return normalizeUnifiedPatchForRenderer(normalizeApplyPatch(directPatch));
    }

    if (directPatch) {
        return normalizeUnifiedPatchForRenderer(directPatch);
    }

    if (toolName === "apply_patch" && typeof block.text === "string") {
        return normalizeUnifiedPatchForRenderer(normalizeApplyPatch(block.text));
    }

    return "";
}

function readStructuredDiffChange(value: unknown): StructuredDiffChange | null {
    if (!value || typeof value !== "object") return null;
    const change = value as Record<string, unknown>;
    if (
        (change.type !== "add" && change.type !== "remove") ||
        typeof change.text !== "string"
    ) {
        return null;
    }
    return {
        type: change.type,
        oldLine: typeof change.old_line === "number" ? change.old_line : null,
        newLine: typeof change.new_line === "number" ? change.new_line : null,
        text: change.text,
    };
}

function readStructuredDiff(value: unknown): StructuredDiff | null {
    if (!value || typeof value !== "object") return null;
    const diff = value as Record<string, unknown>;
    if (
        typeof diff.path !== "string" ||
        typeof diff.added !== "number" ||
        typeof diff.removed !== "number"
    ) {
        return null;
    }

    const changes = Array.isArray(diff.changes)
        ? diff.changes
              .map(readStructuredDiffChange)
              .filter((change): change is StructuredDiffChange => change !== null)
        : undefined;
    const lines = Array.isArray(diff.lines)
        ? diff.lines.filter((line): line is string => typeof line === "string")
        : undefined;
    const kind = ["add", "update", "delete", "move"].includes(
        String(diff.kind),
    )
        ? (String(diff.kind) as StructuredDiff["kind"])
        : undefined;

    return {
        path: diff.path,
        kind,
        sourcePath: typeof diff.source_path === "string" ? diff.source_path : null,
        added: diff.added,
        removed: diff.removed,
        changes,
        lines,
        truncated: diff.truncated === true,
        shownChanges:
            typeof diff.shown_changes === "number"
                ? diff.shown_changes
                : undefined,
        totalChanges:
            typeof diff.total_changes === "number"
                ? diff.total_changes
                : undefined,
    };
}

function extractStringField(value: unknown, keys: string[]): string {
    if (!value || typeof value !== "object") {
        return "";
    }

    const record = value as Record<string, unknown>;
    for (const key of keys) {
        if (typeof record[key] === "string" && record[key]) {
            return record[key] as string;
        }
    }

    return "";
}

function buildStructuredRowsFromLines(lines: string[]): StructuredDiffRow[] {
    const rows: StructuredDiffRow[] = [];
    const hunkRe = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
    let oldLine = 1;
    let newLine = 1;

    for (const line of lines) {
        if (line.startsWith("@@")) {
            const match = hunkRe.exec(line);
            if (match) {
                oldLine = Number.parseInt(match[1] ?? "1", 10);
                newLine = Number.parseInt(match[2] ?? "1", 10);
            }
            rows.push({
                kind: "meta",
                oldLine: null,
                newLine: null,
                text: line,
            });
            continue;
        }

        if (line.startsWith("\\")) {
            rows.push({
                kind: "meta",
                oldLine: null,
                newLine: null,
                text: line,
            });
            continue;
        }

        if (line.startsWith("+")) {
            rows.push({
                kind: "add",
                oldLine: null,
                newLine,
                text: line.slice(1) || " ",
            });
            newLine += 1;
            continue;
        }

        if (line.startsWith("-")) {
            rows.push({
                kind: "remove",
                oldLine,
                newLine: null,
                text: line.slice(1) || " ",
            });
            oldLine += 1;
            continue;
        }

        rows.push({
            kind: "context",
            oldLine,
            newLine,
            text: line.startsWith(" ") ? line.slice(1) || " " : line || " ",
        });
        oldLine += 1;
        newLine += 1;
    }

    return rows;
}

function makeSyntheticWritePatch(fileName: string, content: string): string {
    const lines = content.split("\n");
    const count = lines.length;

    return [
        "--- /dev/null",
        `+++ ${fileName}`,
        `@@ -0,0 +1,${count} @@`,
        ...lines.map((line) => `+${line}`),
    ].join("\n");
}

function finalizeSimplifiedHunk(
    lines: string[],
    oldStart: number,
    newStart: number,
): string[] {
    const oldCount = lines.filter(
        (line) => !line.startsWith("+") && !line.startsWith("\\"),
    ).length;
    const newCount = lines.filter(
        (line) => !line.startsWith("-") && !line.startsWith("\\"),
    ).length;

    return [
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        ...lines.map(normalizeUnifiedHunkLine),
    ];
}

function normalizeUnifiedHunkLine(line: string): string {
    if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line.startsWith("\\")
    ) {
        return line;
    }

    return ` ${line}`;
}

function normalizeUnifiedPatchForRenderer(patchText: string): string {
    let inHunk = false;
    const compactPatchText = patchText.replace(/\n{2,}(?=--- )/g, "\n");

    return compactPatchText
        .split("\n")
        .map((line) => {
            if (line.startsWith("@@")) {
                inHunk = true;
                return line;
            }

            if (
                line.startsWith("--- ") ||
                line.startsWith("+++ ") ||
                line.startsWith("diff ") ||
                line.startsWith("index ")
            ) {
                inHunk = false;
                return line;
            }

            return inHunk ? normalizeUnifiedHunkLine(line) : line;
        })
        .join("\n");
}

function normalizeApplyPatchBody(lines: string[]): string[] {
    if (lines.some((line) => /^@@\s+-\d/.test(line))) {
        return lines;
    }

    const hunks: string[] = [];
    let currentHunk: string[] = [];
    let oldStart = 1;
    let newStart = 1;

    for (const line of lines) {
        if (line.startsWith("@@")) {
            if (currentHunk.length > 0) {
                hunks.push(
                    ...finalizeSimplifiedHunk(currentHunk, oldStart, newStart),
                );
                oldStart += currentHunk.filter(
                    (entry) => !entry.startsWith("+") && !entry.startsWith("\\"),
                ).length;
                newStart += currentHunk.filter(
                    (entry) => !entry.startsWith("-") && !entry.startsWith("\\"),
                ).length;
                currentHunk = [];
            }
            continue;
        }

        currentHunk.push(line);
    }

    if (currentHunk.length > 0) {
        hunks.push(...finalizeSimplifiedHunk(currentHunk, oldStart, newStart));
    }

    return hunks;
}

function normalizeApplyPatch(patchText: string): string {
    const lines = patchText.split("\n");
    const output: string[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (line.startsWith("*** Update File: ")) {
            const originalPath = line.slice("*** Update File: ".length).trim();
            let nextPath = originalPath;
            const body: string[] = [];
            index += 1;

            if (lines[index]?.startsWith("*** Move to: ")) {
                nextPath = lines[index].slice("*** Move to: ".length).trim();
                index += 1;
            }

            while (index < lines.length && !lines[index].startsWith("*** ")) {
                body.push(lines[index]);
                index += 1;
            }

            output.push(
                `--- ${originalPath}`,
                `+++ ${nextPath}`,
                ...normalizeApplyPatchBody(body),
                "",
            );
            continue;
        }

        if (line.startsWith("*** Add File: ")) {
            const filePath = line.slice("*** Add File: ".length).trim();
            const body: string[] = [];
            index += 1;

            while (index < lines.length && !lines[index].startsWith("*** ")) {
                body.push(lines[index]);
                index += 1;
            }

            const additions = body.filter((entry) => entry.startsWith("+")).length;
            output.push(
                "--- /dev/null",
                `+++ ${filePath}`,
                `@@ -0,0 +1,${additions} @@`,
                ...body,
                "",
            );
            continue;
        }

        if (line.startsWith("*** Delete File: ")) {
            const filePath = line.slice("*** Delete File: ".length).trim();
            output.push(
                `--- ${filePath}`,
                "+++ /dev/null",
                "@@ -1 +0,0 @@",
                "-Deleted file",
                "",
            );
            index += 1;
            continue;
        }

        index += 1;
    }

    return output.join("\n").trim();
}
