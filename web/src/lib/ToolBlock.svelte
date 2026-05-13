<script lang="ts">
    import { browser } from "$app/environment";
    import { tick } from "svelte";
    import { DIFFS_TAG_NAME, FileDiff, processPatch } from "@pierre/diffs";
    import "../../node_modules/@pierre/diffs/dist/components/web-components.js";

    let { block, expanded, onToggle } = $props<{
        block: any;
        expanded: boolean;
        onToggle: () => void;
    }>();

    let isMobile = $state(false);
    let isTablet = $state(false);

    $effect(() => {
        if (!browser) return;
        const mqMobile = window.matchMedia("(max-width: 767px)");
        const mqTablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
        isMobile = mqMobile.matches;
        isTablet = mqTablet.matches;
        const handler = () => {
            isMobile = mqMobile.matches;
            isTablet = mqTablet.matches;
        };
        mqMobile.addEventListener("change", handler);
        mqTablet.addEventListener("change", handler);
        return () => {
            mqMobile.removeEventListener("change", handler);
            mqTablet.removeEventListener("change", handler);
        };
    });

    function truncatePath(path: string): string {
        if (!path) return path;
        if (isMobile) {
            const parts = path.split("/");
            return parts[parts.length - 1] ?? path;
        }
        if (isTablet) {
            const parts = path.split("/");
            if (parts.length <= 2) return path;
            return "\u2026/" + parts.slice(-2).join("/");
        }
        return path;
    }

    let diffHosts: HTMLElement[] = [];
    let diffInstances: FileDiff[] = [];
    let showFullDiff = $state(false);
    let diffExpanded = $state(false);

    type StructuredDiffChange = {
        type: "add" | "remove";
        oldLine: number | null;
        newLine: number | null;
        text: string;
    };

    type StructuredDiff = {
        path: string;
        kind?: "add" | "update" | "delete" | "move";
        sourcePath?: string | null;
        added: number;
        removed: number;
        changes?: StructuredDiffChange[];
        truncated: boolean;
        shownChanges?: number;
        totalChanges?: number;
    };

    function readStructuredDiffChange(
        value: unknown,
    ): StructuredDiffChange | null {
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
            oldLine:
                typeof change.old_line === "number" ? change.old_line : null,
            newLine:
                typeof change.new_line === "number" ? change.new_line : null,
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
                  .filter((c): c is StructuredDiffChange => c !== null)
            : undefined;
        const kind = ["add", "update", "delete", "move"].includes(
            String(diff.kind),
        )
            ? (String(diff.kind) as StructuredDiff["kind"])
            : undefined;
        return {
            path: diff.path,
            kind,
            sourcePath:
                typeof diff.source_path === "string" ? diff.source_path : null,
            added: diff.added,
            removed: diff.removed,
            changes,
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

    function readStructuredDiffs(
        metadata: Record<string, unknown> | undefined,
    ): StructuredDiff[] {
        if (!metadata) return [];
        const files = Array.isArray(metadata.files)
            ? metadata.files
                  .map(readStructuredDiff)
                  .filter((d): d is StructuredDiff => d !== null)
            : [];
        if (files.length > 0) return files;
        const diff = readStructuredDiff(metadata.diff);
        return diff ? [diff] : [];
    }

    function stringifyValue(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
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

    function cleanupDiffs(): void {
        for (const instance of diffInstances) {
            instance.cleanUp();
        }
        diffInstances = [];
    }

    function makeSyntheticWritePatch(
        fileName: string,
        content: string,
    ): string {
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
                        ...finalizeSimplifiedHunk(
                            currentHunk,
                            oldStart,
                            newStart,
                        ),
                    );
                    oldStart += currentHunk.filter(
                        (entry) =>
                            !entry.startsWith("+") && !entry.startsWith("\\"),
                    ).length;
                    newStart += currentHunk.filter(
                        (entry) =>
                            !entry.startsWith("-") && !entry.startsWith("\\"),
                    ).length;
                    currentHunk = [];
                }
                continue;
            }

            currentHunk.push(line);
        }

        if (currentHunk.length > 0) {
            hunks.push(
                ...finalizeSimplifiedHunk(currentHunk, oldStart, newStart),
            );
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
                const originalPath = line
                    .slice("*** Update File: ".length)
                    .trim();
                let nextPath = originalPath;
                const body: string[] = [];
                index += 1;

                if (lines[index]?.startsWith("*** Move to: ")) {
                    nextPath = lines[index]
                        .slice("*** Move to: ".length)
                        .trim();
                    index += 1;
                }

                while (
                    index < lines.length &&
                    !lines[index].startsWith("*** ")
                ) {
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

                while (
                    index < lines.length &&
                    !lines[index].startsWith("*** ")
                ) {
                    body.push(lines[index]);
                    index += 1;
                }

                const additions = body.filter((entry) =>
                    entry.startsWith("+"),
                ).length;
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

    // For read_file: human-readable offset/limit range, only when partial
    let readFileRange = $derived.by(() => {
        if (
            block.originalToolName !== "read_file" &&
            block.originalToolName !== "view_file"
        )
            return "";
        const args = block.args ?? {};
        const offset = typeof args.offset === "number" ? args.offset : null;
        const limit = typeof args.limit === "number" ? args.limit : null;
        if (offset === null && limit === null) return "";
        const parts: string[] = [];
        if (offset !== null) parts.push(`offset=${offset}`);
        if (limit !== null) parts.push(`limit=${limit}`);
        return parts.join(" ");
    });

    let effectiveDiffPatch = $derived.by(() => {
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
            typeof args?.content === "string"
        ) {
            const fileName = String(
                args?.file_path ?? args?.path ?? block.toolName ?? "file",
            );
            return normalizeUnifiedPatchForRenderer(
                makeSyntheticWritePatch(fileName, args.content),
            );
        }

        if (
            toolName === "apply_patch" &&
            typeof directPatch === "string" &&
            directPatch
        ) {
            return normalizeUnifiedPatchForRenderer(
                normalizeApplyPatch(directPatch),
            );
        }

        if (typeof directPatch === "string" && directPatch) {
            return normalizeUnifiedPatchForRenderer(directPatch);
        }

        if (toolName === "apply_patch" && typeof block.text === "string") {
            return normalizeUnifiedPatchForRenderer(
                normalizeApplyPatch(block.text),
            );
        }

        return "";
    });

    let effectiveStructuredDiffs = $derived(
        readStructuredDiffs(block.metadata),
    );
    let hasStructuredDiffs = $derived(effectiveStructuredDiffs.length > 0);

    let shouldRenderDiff = $derived(
        effectiveDiffPatch.trim().length > 0 || hasStructuredDiffs,
    );

    let totalAdded = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.reduce((s, d) => s + d.added, 0);
        }
        if (effectiveDiffPatch) {
            const lines = effectiveDiffPatch.split("\n");
            let count = 0;
            for (const line of lines) {
                if (line.startsWith("+") && !line.startsWith("+++")) count++;
            }
            return count;
        }
        return 0;
    });

    let totalRemoved = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.reduce((s, d) => s + d.removed, 0);
        }
        if (effectiveDiffPatch) {
            const lines = effectiveDiffPatch.split("\n");
            let count = 0;
            for (const line of lines) {
                if (line.startsWith("-") && !line.startsWith("---")) count++;
            }
            return count;
        }
        return 0;
    });

    let diffFileNames = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.map((d) => d.path);
        }
        if (diffFiles.length > 0) {
            return diffFiles.map((f) => f.name);
        }
        return [];
    });

    let diffFileNamesDisplay = $derived.by(() => {
        if (diffFileNames.length === 0) return "";
        const truncated = diffFileNames.map((n) => truncatePath(n));
        if (truncated.length <= 2) return truncated.join(", ");
        return `${truncated[0]}, ${truncated[1]}, +${truncated.length - 2} more`;
    });

    let diffFiles = $derived.by(() => {
        if (!effectiveDiffPatch) {
            return [];
        }

        try {
            return processPatch(effectiveDiffPatch, "tool-block", false).files;
        } catch {
            return [];
        }
    });

    let diffLineCount = $derived.by(() => {
        if (!effectiveDiffPatch) {
            return 0;
        }

        return effectiveDiffPatch.split("\n").length;
    });

    let shouldClampDiff = $derived(diffLineCount > 100);

    $effect(() => {
        effectiveDiffPatch;
        showFullDiff = false;
    });

    $effect(() => {
        if (!browser || !shouldRenderDiff || !diffExpanded) {
            return () => {
                cleanupDiffs();
            };
        }

        const files = diffFiles;

        void tick().then(() => {
            cleanupDiffs();

            diffInstances = files.flatMap((file, index) => {
                const host = diffHosts[index];
                if (!host) {
                    return [];
                }

                const instance = new FileDiff({
                    theme: "pierre-dark",
                    themeType: "system",
                    diffStyle: "unified",
                    diffIndicators: "bars",
                    hunkSeparators: "line-info-basic",
                    overflow: "scroll",
                });

                instance.render({
                    fileDiff: file,
                    fileContainer: host,
                });

                return [instance];
            });
        });

        return () => {
            cleanupDiffs();
        };
    });
</script>

{#if shouldRenderDiff}
    <div class="my-4 space-y-3">
        <button
            class="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 transition-colors hover:bg-bg-elevated focus:outline-none"
            onclick={() => {
                diffExpanded = !diffExpanded;
            }}
        >
            <div class="flex items-center gap-3 overflow-hidden">
                <span
                    class="font-mono text-[11px] font-semibold tracking-wide text-accent"
                    >{block.originalToolName === "write_file" ||
                    block.originalToolName === "create_file"
                        ? "Write file"
                        : "Edited"}</span
                >
                {#if diffFileNamesDisplay}
                    <span
                        class="max-w-[300px] truncate font-mono text-[12px] text-text-secondary opacity-80"
                    >
                        {diffFileNamesDisplay}
                    </span>
                {/if}
                {#if totalAdded > 0 || totalRemoved > 0}
                    <span class="text-[12px] font-mono">
                        <span class="text-text-success">+{totalAdded}</span>
                        <span class="text-error"> -{totalRemoved}</span>
                    </span>
                {/if}
            </div>

            <div
                class="ml-4 flex flex-shrink-0 items-center gap-3 text-text-tertiary opacity-60 transition-opacity group-hover:opacity-100"
            >
                <svg
                    class="h-4 w-4 transition-transform duration-200 {diffExpanded
                        ? 'rotate-180'
                        : '-rotate-90'}"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                    ></path></svg
                >
            </div>
        </button>

        {#if diffExpanded}
            {#if hasStructuredDiffs}
                {#each effectiveStructuredDiffs as diff (diff.path)}
                    <div
                        class="overflow-hidden rounded-[8px] border border-border-default bg-bg-code-block"
                    >
                    <div
                        class="border-b border-border-default px-3 py-2 text-[12px] font-mono text-text-secondary"
                    >
                        {#if diff.kind === "add"}
                            Added {truncatePath(diff.path)}
                        {:else if diff.kind === "move" && diff.sourcePath}
                            Moved {truncatePath(diff.sourcePath)} → {truncatePath(diff.path)}
                        {:else if diff.kind === "delete"}
                            Deleted {truncatePath(diff.path)}
                        {:else if diff.kind === "move"}
                            Moved {truncatePath(diff.path)}
                        {:else}
                            Edited {truncatePath(diff.path)}
                        {/if}
                        <span class="ml-2 text-text-success"
                            >(+{diff.added})</span
                        >
                            <span class="ml-1 text-error"
                                >(-{diff.removed})</span
                            >
                        </div>
                        <div class="overflow-x-auto">
                            {#each diff.changes ?? [] as change (`${change.type}-${change.oldLine ?? ""}-${change.newLine ?? ""}-${change.text}`)}
                                <div
                                    class="flex text-[12px] font-mono leading-relaxed {change.type ===
                                    'add'
                                        ? 'bg-bg-toast-ok'
                                        : 'bg-bg-toast-err'}"
                                >
                                    <span
                                        class="w-12 flex-shrink-0 select-none px-2 py-0.5 text-right text-text-tertiary"
                                        >{change.type === "add"
                                            ? (change.newLine ?? "")
                                            : (change.oldLine ?? "")}</span
                                    >
                                    <span
                                        class="w-6 flex-shrink-0 px-1 py-0.5 text-center {change.type ===
                                        'add'
                                            ? 'text-text-success'
                                            : 'text-error'}"
                                        >{change.type === "add"
                                            ? "+"
                                            : "-"}</span
                                    >
                                    <span
                                        class="px-1 py-0.5 whitespace-pre text-text-main"
                                        >{change.text}</span
                                    >
                                </div>
                            {/each}
                            {#if diff.truncated}
                                <div
                                    class="px-3 py-1 text-[12px] font-mono text-text-tertiary"
                                >
                                    ... diff truncated
                                    {#if typeof diff.shownChanges === "number" && typeof diff.totalChanges === "number"}
                                        (showing {diff.shownChanges} of {diff.totalChanges}
                                        changed lines)
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            {:else if diffFiles.length > 0}
                {#each diffFiles as file, index (`${file.name}-${index}`)}
                    <div
                        class="overflow-hidden rounded-[8px] border border-border-default bg-bg-code-block"
                        style:max-height={shouldClampDiff && !showFullDiff
                            ? "2000px"
                            : undefined}
                    >
                        <svelte:element
                            this={DIFFS_TAG_NAME}
                            bind:this={diffHosts[index]}
                            class="block"
                        />
                    </div>
                {/each}
            {:else if effectiveDiffPatch}
                <pre
                    class="overflow-x-auto rounded-[8px] border border-border-default bg-bg-code-block p-4 text-[12px] font-mono text-text-warning"
                    style:max-height={shouldClampDiff && !showFullDiff
                        ? "2000px"
                        : undefined}>{effectiveDiffPatch}</pre>
            {/if}

            {#if shouldClampDiff && !showFullDiff}
                <div class="px-1">
                    <button
                        class="text-[12px] font-mono text-accent transition-colors hover:text-accent"
                        onclick={() => {
                            showFullDiff = true;
                        }}
                    >
                        See more
                    </button>
                </div>
            {:else if shouldClampDiff && showFullDiff}
                <div class="px-1">
                    <button
                        class="text-[12px] font-mono text-accent transition-colors hover:text-accent"
                        onclick={() => {
                            showFullDiff = false;
                        }}
                    >
                        See less
                    </button>
                </div>
            {/if}

            {#if block.hasResult}
                <div class="px-1 text-[12px] font-mono text-text-tertiary">
                    Result
                    <span class="ml-2 text-text-secondary"
                        >{typeof block.result === "string"
                            ? block.result
                            : stringifyValue(block.result)}</span
                    >
                </div>
            {/if}
        {/if}
    </div>
{:else}
    <div class="my-0.5">
        <button
            class="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 transition-colors hover:bg-bg-elevated focus:outline-none"
            onclick={onToggle}
        >
            <div class="flex items-center gap-3 overflow-hidden">
                {#if block.originalToolName === "bash" || block.originalToolName === "execute_command"}
                    <span
                        class="font-mono text-[11px] font-semibold tracking-wide text-accent"
                        >$</span
                    >
                    <span
                        class="max-w-[500px] flex-shrink-0 truncate font-mono text-[11px] text-text-secondary"
                        >{(block.toolName || "").replace("$ ", "")}</span
                    >
                {:else if block.originalToolName === "read_file" || block.originalToolName === "view_file"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold tracking-wide text-accent"
                        >Read file</span
                    >
                    <span
                        class="truncate font-mono text-[10px] text-text-secondary opacity-90"
                        >{block.toolName !== block.originalToolName
                            ? truncatePath(block.toolName)
                            : ""}</span
                    >
                    {#if readFileRange}
                        <span
                            class="font-mono text-[11px] text-text-tertiary opacity-70"
                            >{readFileRange}</span
                        >
                    {/if}
                {:else}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold tracking-wide text-accent"
                        >{block.originalToolName ||
                            block.toolName ||
                            "tool"}</span
                    >
                    {#if block.toolName !== block.originalToolName}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary opacity-80"
                            >{block.toolName}</span
                        >
                    {/if}
                {/if}
            </div>

            <div
                class="ml-4 flex flex-shrink-0 items-center gap-3 text-text-tertiary opacity-60 transition-opacity group-hover:opacity-100"
            >
                <svg
                    class="h-4 w-4 transition-transform duration-200 {expanded
                        ? 'rotate-180'
                        : '-rotate-90'}"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                    ></path></svg
                >
            </div>
        </button>

        {#if expanded}
            <div
                class="mt-1.5 mb-3 overflow-hidden rounded-[6px] border border-border-default bg-bg-code-block"
            >
                <div class="overflow-x-auto bg-bg-code-block p-4">
                    <pre
                        class="text-[12px] font-mono leading-relaxed {block.error
                            ? 'text-error'
                            : 'text-text-warning'}">{block.kind === "tool-call"
                            ? block.originalToolName === "read_file" ||
                              block.originalToolName === "view_file"
                                ? (() => {
                                    const fp = block.args?.file_path ??
                                          block.args?.path ??
                                          "";
                                    return [truncatePath(fp), readFileRange]
                                        .filter(Boolean)
                                        .join(" ");
                                })()
                                : stringifyValue(block.args)
                            : block.text}</pre>
                </div>

                {#if block.kind === "tool-call" && block.hasResult}
                    <div
                        class="border-t border-border-default bg-bg-code-block p-4 overflow-x-auto"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <div
                                class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                            >
                                Result
                            </div>
                            {#if block.error}
                                <div
                                    class="rounded-sm border border-error/30 bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error"
                                >
                                    Failed
                                </div>
                            {/if}
                        </div>
                        <pre
                            class="text-[12px] font-mono leading-relaxed {block.error
                                ? 'text-error'
                                : 'text-text-warning'}">{stringifyValue(
                                block.result,
                            )}</pre>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
