<script lang="ts">
    import { browser } from "$app/environment";
    import { slide } from "svelte/transition";
    import { processPatch } from "@pierre/diffs";
    import PierreDiff from "$lib/PierreDiff.svelte";
    import {
        getDocumentTheme,
        observeDocumentTheme,
        type AppTheme,
    } from "$lib/theme";
    import type { TranscriptBlock } from "$lib/chat/types";
    import {
        buildStructuredDiffRows,
        normalizeToolDiffPatch,
        readStructuredDiffs,
        stringifyValue,
    } from "$lib/chat/tool/diff";

    let { block } = $props<{ block: TranscriptBlock }>();

    let isMobile = $state(false);
    let isTablet = $state(false);
    let showFullDiff = $state(false);
    let diffExpanded = $state(false);
    let appTheme = $state<AppTheme>(getDocumentTheme());

    $effect(() => {
        if (!browser) return;
        const mqMobile = window.matchMedia("(max-width: 767px)");
        const mqTablet = window.matchMedia(
            "(min-width: 768px) and (max-width: 1023px)",
        );
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

    $effect(() => {
        if (!browser) return;
        return observeDocumentTheme((theme) => {
            appTheme = theme;
        });
    });

    const effectiveDiffPatch = $derived(normalizeToolDiffPatch(block));
    const effectiveStructuredDiffs = $derived(readStructuredDiffs(block.metadata));
    const hasStructuredDiffs = $derived(effectiveStructuredDiffs.length > 0);
    const diffFiles = $derived.by(() => {
        if (!effectiveDiffPatch) {
            return [];
        }

        try {
            return processPatch(effectiveDiffPatch, "tool-block", false).files;
        } catch {
            return [];
        }
    });
    const shouldRenderDiff = $derived(
        effectiveDiffPatch.trim().length > 0 || hasStructuredDiffs,
    );
    const totalAdded = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.reduce((sum, diff) => sum + diff.added, 0);
        }
        if (effectiveDiffPatch) {
            let count = 0;
            for (const line of effectiveDiffPatch.split("\n")) {
                if (line.startsWith("+") && !line.startsWith("+++")) count += 1;
            }
            return count;
        }
        return 0;
    });
    const totalRemoved = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.reduce(
                (sum, diff) => sum + diff.removed,
                0,
            );
        }
        if (effectiveDiffPatch) {
            let count = 0;
            for (const line of effectiveDiffPatch.split("\n")) {
                if (line.startsWith("-") && !line.startsWith("---")) count += 1;
            }
            return count;
        }
        return 0;
    });
    const diffFileNames = $derived.by(() => {
        if (hasStructuredDiffs) {
            return effectiveStructuredDiffs.map((diff) => diff.path);
        }
        if (diffFiles.length > 0) {
            return diffFiles.map((file) => file.name);
        }
        return [];
    });
    const diffFileNamesDisplay = $derived.by(() => {
        if (diffFileNames.length === 0) return "";
        const truncated = diffFileNames.map((name) => truncatePath(name));
        if (truncated.length <= 2) return truncated.join(", ");
        return `${truncated[0]}, ${truncated[1]}, +${truncated.length - 2} more`;
    });
    const diffLineCount = $derived.by(() =>
        effectiveDiffPatch ? effectiveDiffPatch.split("\n").length : 0,
    );
    const shouldClampDiff = $derived(diffLineCount > 100);
    const statusLabel = $derived.by(() => {
        if (block.status === "error") return "Failed";
        if (block.status === "aborted") return "Aborted";
        if (block.status === "completed" || block.hasResult) {
            return "";
        }
        if (
            block.status === "streaming" ||
            block.status === "ready" ||
            block.status === "running"
        ) {
            return "Running";
        }
        return "";
    });
    const isRunning = $derived(
        block.status === "streaming" ||
            block.status === "ready" ||
            block.status === "running",
    );

    $effect(() => {
        effectiveDiffPatch;
        showFullDiff = false;
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
            return "…/" + parts.slice(-2).join("/");
        }
        return path;
    }

</script>

{#if shouldRenderDiff}
    <div class="my-1 space-y-3">
        <button
            class="group flex w-full items-center justify-between rounded-[8px] px-2 py-0.5 transition-colors hover:bg-bg-elevated focus:outline-none"
            onclick={() => {
                diffExpanded = !diffExpanded;
            }}
        >
            <div class="flex items-center gap-3 overflow-hidden">
                <span
                    class="font-mono text-[11px] font-semibold tracking-[0.16em] text-text-highlight"
                    >{block.originalToolName === "write_file" ||
                    block.originalToolName === "create_file"
                        ? "Write file"
                        : "Edited"}</span
                >
                {#if diffFileNamesDisplay}
                    <span
                        class="flex-1 min-w-0 truncate font-mono text-[11px] md:text-[12px] text-text-secondary"
                    >
                        {diffFileNamesDisplay}
                    </span>
                {/if}
                {#if totalAdded > 0 || totalRemoved > 0}
                    <span class="flex items-center gap-1.5 text-[11px] md:text-[12px] font-mono shrink-0 whitespace-nowrap">
                        <span class="text-text-success">+{totalAdded}</span>
                        <span class="text-error">-{totalRemoved}</span>
                    </span>
                {/if}
            </div>

            <div
                class="ml-4 flex flex-shrink-0 items-center gap-3 text-text-tertiary opacity-80 transition-opacity group-hover:opacity-100"
            >
                {#if statusLabel}
                <span
                    class="font-mono text-[11px] {block.status === 'error' ||
                    block.status === 'aborted'
                            ? 'text-error'
                            : 'text-text-tertiary'}"
                    >
                        {#if isRunning}
                            <span
                                class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-highlight"
                            ></span>
                        {/if}
                        {statusLabel}
                    </span>
                {/if}
            </div>
        </button>

        {#if diffExpanded}
            {#if hasStructuredDiffs}
                {#each effectiveStructuredDiffs as diff (diff.path)}
                    <div
                        transition:slide={{ duration: 200 }}
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
                            <span class="ml-2 text-text-success">(+{diff.added})</span>
                            <span class="ml-1 text-error">(-{diff.removed})</span>
                        </div>
                        <div class="overflow-x-auto">
                            {#each buildStructuredDiffRows(diff) as row (`${row.kind}-${row.oldLine ?? ""}-${row.newLine ?? ""}-${row.text}`)}
                                {#if row.kind === "meta"}
                                    <div
                                        class="px-3 py-0.5 text-[12px] font-mono text-text-tertiary"
                                    >
                                        {row.text}
                                    </div>
                                {:else}
                                    <div
                                        class="grid min-w-max grid-cols-[3.5rem_3.5rem_2rem_minmax(0,1fr)] text-[12px] font-mono leading-relaxed {row.kind ===
                                        'add'
                                            ? 'bg-bg-toast-ok'
                                            : row.kind === 'remove'
                                              ? 'bg-bg-toast-err'
                                              : 'bg-bg-code-block'}"
                                    >
                                        <span
                                            class="select-none px-2 py-0.5 text-right text-text-tertiary"
                                            >{row.oldLine ?? ""}</span
                                        >
                                        <span
                                            class="select-none px-2 py-0.5 text-right text-text-tertiary"
                                            >{row.newLine ?? ""}</span
                                        >
                                        <span
                                            class="px-1 py-0.5 text-center {row.kind ===
                                            'add'
                                                ? 'text-text-success'
                                                : row.kind === 'remove'
                                                  ? 'text-error'
                                                  : 'text-text-tertiary'}"
                                            >{row.kind === "add"
                                                ? "+"
                                                : row.kind === "remove"
                                                  ? "-"
                                                  : " "}</span
                                        >
                                        <span
                                            class="px-1 py-0.5 whitespace-pre text-text-main"
                                            >{row.text}</span
                                        >
                                    </div>
                                {/if}
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
                        transition:slide={{ duration: 200 }}
                        class="overflow-hidden rounded-[8px] border border-border-default bg-bg-code-block"
                        style:max-height={shouldClampDiff && !showFullDiff
                            ? "2000px"
                            : undefined}
                    >
                        <PierreDiff
                            file={file}
                            theme={appTheme}
                            class="block diff-mobile-scale"
                        />
                    </div>
                {/each}
            {:else if effectiveDiffPatch}
                <pre
                    transition:slide={{ duration: 200 }}
                    class="overflow-x-auto rounded-[8px] border border-border-default bg-bg-code-block p-4 text-[10px] md:text-[12px] font-mono text-text-warning"
                    style:max-height={shouldClampDiff && !showFullDiff
                        ? "2000px"
                        : undefined}>{effectiveDiffPatch}</pre>
            {/if}

            {#if shouldClampDiff && !showFullDiff}
                <div transition:slide={{ duration: 200 }} class="px-1">
                    <button
                        class="text-[12px] font-mono text-text-highlight transition-colors hover:text-text-secondary"
                        onclick={() => {
                            showFullDiff = true;
                        }}
                    >
                        See more
                    </button>
                </div>
            {:else if shouldClampDiff && showFullDiff}
                <div transition:slide={{ duration: 200 }} class="px-1">
                    <button
                        class="text-[12px] font-mono text-text-highlight transition-colors hover:text-text-secondary"
                        onclick={() => {
                            showFullDiff = false;
                        }}
                    >
                        See less
                    </button>
                </div>
            {/if}

            {#if block.hasResult}
                <div
                    transition:slide={{ duration: 200 }}
                    class="px-1 text-[12px] font-mono text-text-tertiary"
                >
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
{/if}
