<script lang="ts">
    import { browser } from "$app/environment";
    import { tick } from "svelte";
    import { processPatch } from "@pierre/diffs";
    import type { ChangeRecord, ChumpState } from "$lib/chump/types";
    import PierreDiff from "$lib/PierreDiff.svelte";
    import {
        getDocumentTheme,
        observeDocumentTheme,
        type AppTheme,
    } from "$lib/theme";

    let {
        state: sessionState,
        sidebarOpen = false,
        onRequestCommitPush,
        onRequestCreatePr,
    } = $props<{
        state: ChumpState | null;
        sidebarOpen?: boolean;
        onRequestCommitPush?: () => void;
        onRequestCreatePr?: () => void;
    }>();

    let isCollapsed = $state(
        browser
            ? localStorage.getItem("workspace-panel-collapsed") === "true"
            : false,
    );

    function toggleCollapse() {
        isCollapsed = !isCollapsed;
        if (browser) {
            localStorage.setItem(
                "workspace-panel-collapsed",
                String(isCollapsed),
            );
        }
    }

    let modalOpen = $state(false);
    let selectedPath: string | null = $state(null);
    let userClosedDiff = $state(false);
    let searchQuery = $state("");
    let mobileDiffFontSize = $state(11);
    let isLargeScreen = $state(false);
    let appTheme = $state<AppTheme>(getDocumentTheme());

    $effect(() => {
        if (!browser) return;
        const media = window.matchMedia("(min-width: 1024px)");
        isLargeScreen = media.matches;
        const listener = (e: MediaQueryListEvent) => {
            isLargeScreen = e.matches;
        };
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    });

    $effect(() => {
        if (isLargeScreen && modalOpen) {
            modalOpen = false;
        }
    });

    type DiffRow = {
        kind: "add" | "remove" | "context" | "meta";
        oldLine: number | null;
        newLine: number | null;
        text: string;
    };

    type FileGroup = {
        path: string;
        added: number;
        removed: number;
        changeCount: number;
        records: ChangeRecord[];
        lastIndex: number;
    };

    let groupedFiles = $derived(buildFileGroups(sessionState));
    let filteredFiles = $derived(
        groupedFiles.filter((f) =>
            f.path.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
    );
    let filesCount = $derived(filteredFiles.length);
    let totalChangesCount = $derived(groupedFiles.length);
    let totalAdded = $derived(
        groupedFiles.reduce((sum, file) => sum + file.added, 0),
    );
    let totalRemoved = $derived(
        groupedFiles.reduce((sum, file) => sum + file.removed, 0),
    );

    let selectedFile = $derived(
        filteredFiles.find((file) => file.path === selectedPath) ?? null,
    );
    let selectedFileIndex = $derived(
        selectedPath
            ? filteredFiles.findIndex((file) => file.path === selectedPath)
            : -1,
    );
    let stackedFiles = $derived.by(() =>
        filteredFiles.map((file) => ({
            ...file,
            recordDiffFiles: file.records.map((record) => {
                const patch = toUnifiedPatch(record);
                if (!patch) return [];
                try {
                    return processPatch(patch, "workspace-state", false).files;
                } catch {
                    return [];
                }
            }),
        })),
    );

    $effect(() => {
        if (!browser) return;
        return observeDocumentTheme((theme) => {
            appTheme = theme;
        });
    });

    $effect(() => {
        if (groupedFiles.length === 0 && modalOpen) {
            modalOpen = false;
        }
    });

    // Only auto-select on desktop to avoid locking mobile users into a diff view
    $effect(() => {
        if (!browser) return;
        if (
            window.innerWidth > 768 &&
            !selectedPath &&
            filteredFiles.length > 0 &&
            !userClosedDiff
        ) {
            selectedPath = filteredFiles[0].path;
        }
    });

    function buildFileGroups(currentState: ChumpState | null): FileGroup[] {
        const grouped = new Map<string, FileGroup>();
        const changeRecords = normalizeChangeRecords(
            currentState?.change_records,
        );

        changeRecords.forEach((record, index) => {
            const existing = grouped.get(record.path);
            if (existing) {
                existing.added += record.added;
                existing.removed += record.removed;
                existing.changeCount += 1;
                existing.records.push(record);
                existing.lastIndex = index;
                return;
            }

            grouped.set(record.path, {
                path: record.path,
                added: record.added,
                removed: record.removed,
                changeCount: 1,
                records: [record],
                lastIndex: index,
            });
        });

        const fileDiffs = currentState?.file_diffs ?? {};
        const touchedPaths = currentState?.files_touched ?? [];
        const fallbackPaths = new Set<string>([
            ...touchedPaths,
            ...Object.keys(fileDiffs),
        ]);

        for (const path of fallbackPaths) {
            if (grouped.has(path)) continue;
            const summary = fileDiffs[path] ?? { added: 0, removed: 0 };
            grouped.set(path, {
                path,
                added: summary.added ?? 0,
                removed: summary.removed ?? 0,
                changeCount: 0,
                records: [],
                lastIndex: -1,
            });
        }

        return Array.from(grouped.values()).sort((a, b) => {
            if (a.lastIndex !== b.lastIndex) {
                return b.lastIndex - a.lastIndex;
            }
            return a.path.localeCompare(b.path);
        });
    }

    function normalizeChangeRecords(
        value: ChumpState["change_records"] | undefined,
    ): ChangeRecord[] {
        if (!Array.isArray(value)) return [];
        return value.filter(isChangeRecord);
    }

    function isChangeRecord(value: unknown): value is ChangeRecord {
        if (!value || typeof value !== "object") return false;
        const record = value as Record<string, unknown>;
        return (
            typeof record.path === "string" &&
            typeof record.added === "number" &&
            typeof record.removed === "number"
        );
    }

    function splitPath(path: string): { dir: string; name: string } {
        if (!path) return { dir: "", name: "" };
        const parts = path.split("/");
        if (parts.length === 1) return { dir: "", name: parts[0]! };
        return {
            dir: parts.slice(0, -1).join("/") + "/",
            name: parts[parts.length - 1]!,
        };
    }
    function openFile(path: string): void {
        selectedPath = path;
        userClosedDiff = false;
        if (!isLargeScreen) {
            modalOpen = true;
        }
        void scrollToFile(path);
    }

    async function scrollToFile(path: string): Promise<void> {
        if (!browser) return;
        await tick();
        const sections = document.querySelectorAll<HTMLElement>(
            "[data-workspace-diff-path]",
        );
        const target = Array.from(sections).find(
            (section) =>
                section.dataset.workspaceDiffPath === path &&
                section.getClientRects().length > 0,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeModal(): void {
        userClosedDiff = true;
        modalOpen = false;
    }

    function selectPreviousFile(): void {
        if (selectedFileIndex <= 0) return;
        const path = filteredFiles[selectedFileIndex - 1]?.path;
        if (path) openFile(path);
    }

    function selectNextFile(): void {
        if (
            selectedFileIndex < 0 ||
            selectedFileIndex >= filteredFiles.length - 1
        )
            return;
        const path = filteredFiles[selectedFileIndex + 1]?.path;
        if (path) openFile(path);
    }

    function describeKind(record: ChangeRecord): string {
        switch (record.kind) {
            case "add":
                return "Created";
            case "delete":
                return "Deleted";
            case "move":
                return "Moved";
            default:
                return "Edited";
        }
    }

    function buildRows(record: ChangeRecord): DiffRow[] {
        if (Array.isArray(record.lines) && record.lines.length > 0) {
            return buildRowsFromLines(record.lines);
        }

        return (record.changes ?? []).map((change) => ({
            kind: change.type,
            oldLine:
                typeof change.old_line === "number" ? change.old_line : null,
            newLine:
                typeof change.new_line === "number" ? change.new_line : null,
            text: change.text.length > 0 ? change.text : " ",
        }));
    }

    function buildRowsFromLines(lines: string[]): DiffRow[] {
        const rows: DiffRow[] = [];
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

    function lineClass(kind: DiffRow["kind"]): string {
        switch (kind) {
            case "add":
                return "bg-success/10 text-success";
            case "remove":
                return "bg-error/10 text-error";
            case "meta":
                return "bg-bg-elevated text-text-tertiary";
            default:
                return "text-text-secondary";
        }
    }

    function toUnifiedPatch(record: ChangeRecord): string {
        const body = Array.isArray(record.lines) ? record.lines : [];
        if (body.length === 0) return "";

        const nextPath = record.path;
        const prevPath =
            record.kind === "add"
                ? "/dev/null"
                : record.source_path || record.path;
        const afterPath = record.kind === "delete" ? "/dev/null" : nextPath;

        return [`--- ${prevPath}`, `+++ ${afterPath}`, ...body].join("\n");
    }
</script>

{#snippet diffPanel()}
    <div
        class="flex min-w-0 flex-1 flex-col bg-bg-surface h-full overflow-hidden"
    >
        <div
            class="flex items-center justify-between border-b border-border-subtle px-4 md:px-6 py-2 md:py-3 shrink-0 bg-bg-surface"
        >
            <div class="flex items-center gap-3 min-w-0">
                <button
                    class="md:hidden p-1 -ml-2 text-text-tertiary active:bg-bg-hover rounded-full"
                    aria-label="Back to file list"
                    onclick={() => (selectedPath = null)}
                >
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 19l-7-7 7-7"
                        />
                    </svg>
                </button>
                <div
                    class="truncate font-mono text-[11px] md:text-[13px] font-medium text-text-main"
                >
                    All changes
                </div>
                <div
                    class="hidden items-center gap-3 font-mono text-[11px] tabular-nums md:flex"
                >
                    {#if totalAdded > 0}<span class="text-text-success"
                            >+{totalAdded}</span
                        >{/if}
                    {#if totalRemoved > 0}<span class="text-text-error"
                            >-{totalRemoved}</span
                        >{/if}
                    <span class="text-text-tertiary">~{totalChangesCount}</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <div
                    class="md:hidden text-[10px] text-text-tertiary font-mono tabular-nums"
                >
                    {selectedFileIndex >= 0
                        ? selectedFileIndex + 1
                        : 0}/{filteredFiles.length}
                </div>
                <button
                    type="button"
                    class="md:hidden h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-tertiary disabled:opacity-35"
                    onclick={selectPreviousFile}
                    disabled={selectedFileIndex <= 0}
                    aria-label="Previous changed file"
                >
                    <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 19l-7-7 7-7"
                        />
                    </svg>
                </button>
                <button
                    type="button"
                    class="md:hidden h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-tertiary disabled:opacity-35"
                    onclick={selectNextFile}
                    disabled={selectedFileIndex < 0 ||
                        selectedFileIndex >= filteredFiles.length - 1}
                    aria-label="Next changed file"
                >
                    <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </button>
                <div
                    class="flex items-center gap-3 font-mono text-[12px] md:hidden"
                >
                    {#if totalAdded > 0}<span class="text-text-success"
                            >+{totalAdded}</span
                        >{/if}
                    {#if totalRemoved > 0}<span class="text-text-error"
                            >-{totalRemoved}</span
                        >{/if}
                    <span class="text-text-tertiary">~{totalChangesCount}</span>
                </div>
                {#if isLargeScreen}
                    <button
                        type="button"
                        aria-label="Close diff"
                        class="hidden md:flex rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary ml-2"
                        onclick={() => {
                            selectedPath = null;
                            userClosedDiff = true;
                        }}
                    >
                        <svg
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.8"
                                d="M6 6l12 12M18 6L6 18"
                            ></path>
                        </svg>
                    </button>
                {/if}
            </div>
        </div>

        {#if stackedFiles.length > 0}
            <div
                class="md:hidden flex flex-col gap-3 border-b border-border-subtle px-5 py-3 shrink-0"
            >
                <div class="flex items-center justify-between">
                    <span
                        class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                        >Text Size</span
                    >
                    <button
                        type="button"
                        class="text-[10px] font-mono text-text-tertiary hover:text-text-main transition-colors"
                        onclick={() => (mobileDiffFontSize = 11)}
                    >
                        Reset
                    </button>
                </div>
                <div class="relative w-full h-6 flex items-center">
                    <div
                        class="absolute inset-0 flex items-center justify-between px-[7px] pointer-events-none"
                    >
                        {#each Array(21) as _, i (i)}
                            {@const val = 9 + i / 4}
                            <div
                                class="w-[1.5px] rounded-full transition-colors duration-150 {i %
                                    4 ===
                                0
                                    ? 'h-3.5'
                                    : 'h-1.5'} {mobileDiffFontSize >= val
                                    ? 'bg-text-main'
                                    : 'bg-border-default'}"
                            ></div>
                        {/each}
                    </div>
                    <input
                        type="range"
                        min="9"
                        max="14"
                        step="0.25"
                        bind:value={mobileDiffFontSize}
                        class="creative-slider w-full h-full m-0 cursor-pointer"
                        aria-label="Diff text size"
                    />
                </div>
            </div>
        {/if}

        <div
            class="min-h-0 flex-1 overflow-y-auto bg-bg-surface-alt/10 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-0"
        >
            {#if stackedFiles.length === 0}
                <div
                    class="flex h-full items-center justify-center text-[13px] text-text-tertiary"
                >
                    Summary counts available. Full diffs for new edits.
                </div>
            {:else}
                <div class="flex flex-col">
                    {#each stackedFiles as file (file.path)}
                        <section
                            class="scroll-mt-0 border-b-4 border-border-subtle"
                            data-workspace-diff-path={file.path}
                        >
                            <div
                                class="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-bg-surface px-4 py-2 md:px-6"
                            >
                                <div
                                    class="min-w-0 truncate font-mono text-[11px] font-medium text-text-main md:text-[13px]"
                                >
                                    {file.path}
                                </div>
                                <div
                                    class="ml-4 flex shrink-0 items-center gap-3 font-mono text-[11px]"
                                >
                                    {#if file.added > 0}<span
                                            class="text-text-success"
                                            >+{file.added}</span
                                        >{/if}
                                    {#if file.removed > 0}<span
                                            class="text-text-error"
                                            >-{file.removed}</span
                                        >{/if}
                                </div>
                            </div>
                            {#each file.records as record, index (`${file.path}-${index}`)}
                                <div>
                                    <div
                                        class="flex items-center justify-between bg-bg-elevated/40 px-6 py-1.5 border-b border-border-subtle"
                                    >
                                        <div
                                            class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                                        >
                                            {describeKind(record)}
                                        </div>
                                    </div>
                                    {#if file.recordDiffFiles[index] && file.recordDiffFiles[index].length > 0}
                                        {#each file.recordDiffFiles[index] as fileDiff, fileIndex (`${fileDiff.name}-${fileIndex}`)}
                                            <div
                                                class="overflow-hidden bg-bg-code-block"
                                            >
                                                <PierreDiff
                                                    file={fileDiff}
                                                    theme={appTheme}
                                                    class="block diff-mobile-scale"
                                                    style={`--mobile-diff-font-size:${mobileDiffFontSize}px`}
                                                />
                                            </div>
                                        {/each}
                                    {:else}
                                        <div
                                            class="overflow-x-auto font-mono leading-5 md:leading-6 bg-bg-surface py-1 md:py-2 diff-mobile-scale"
                                            style={`--mobile-diff-font-size:${mobileDiffFontSize}px`}
                                        >
                                            <table
                                                class="w-full border-collapse"
                                            >
                                                <tbody>
                                                    {#each buildRows(record) as row (`${row.kind}-${row.oldLine ?? ""}-${row.newLine ?? ""}-${row.text}`)}
                                                        <tr
                                                            class="{lineClass(
                                                                row.kind,
                                                            )} hover:bg-bg-hover/20 transition-colors group"
                                                        >
                                                            <td
                                                                class="w-8 md:w-10 select-none pr-2 md:pr-3 text-right text-text-tertiary/30 border-r border-border-subtle/30"
                                                                >{row.oldLine ??
                                                                    ""}</td
                                                            >
                                                            <td
                                                                class="w-8 md:w-10 select-none pr-2 md:pr-3 text-right text-text-tertiary/30 border-r border-border-subtle/30"
                                                                >{row.newLine ??
                                                                    ""}</td
                                                            >
                                                            <td
                                                                class="whitespace-pre px-3 md:px-4"
                                                                >{row.text}</td
                                                            >
                                                        </tr>
                                                    {/each}
                                                </tbody>
                                            </table>
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </section>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/snippet}

{#if isLargeScreen && selectedPath && selectedFile && !isCollapsed}
    <div
        class="hidden lg:flex flex-col h-full flex-1 min-w-[550px] border-l border-border-subtle bg-bg-surface text-text-main"
    >
        {@render diffPanel()}
    </div>
{/if}

<aside
    class="hidden md:flex h-full flex-shrink-0 flex-col border-l border-border-subtle bg-bg-surface-alt text-text-main transition-all duration-200"
    class:w-[420px]={!isCollapsed}
    class:w-0={isCollapsed}
    class:overflow-hidden={isCollapsed}
    class:border-l-0={isCollapsed}
>
    <div class="border-b border-border-subtle px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-3">
            <div class="flex items-center gap-1.5">
                <button
                    type="button"
                    class="workspace-action-button"
                    onclick={onRequestCommitPush}
                    disabled={!onRequestCommitPush || totalChangesCount === 0}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.9"
                            d="M5 12l4 4L19 6"
                        />
                    </svg>
                    Commit & Push
                </button>
                <button
                    type="button"
                    class="workspace-action-button workspace-action-button-primary"
                    onclick={onRequestCreatePr}
                    disabled={!onRequestCreatePr}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.9"
                            d="M7 7h7m0 0v7m0-7L5 16m10-1h4v4h-4z"
                        />
                    </svg>
                    Create PR
                </button>
            </div>
            <div class="min-w-0 flex-1"></div>
            <div class="flex items-center gap-1 text-text-tertiary">
                <button
                    class="workspace-icon-button"
                    aria-label="Previous changed file"
                    onclick={selectPreviousFile}
                    disabled={selectedFileIndex <= 0}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M7 14l5-5 5 5"
                        />
                    </svg>
                </button>
                <button
                    class="workspace-icon-button"
                    aria-label="Next changed file"
                    onclick={selectNextFile}
                    disabled={selectedFileIndex < 0 ||
                        selectedFileIndex >= filteredFiles.length - 1}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M7 10l5 5 5-5"
                        />
                    </svg>
                </button>
                <!-- <button
                    class="workspace-icon-button"
                    aria-label={selectedPath ? "Hide diff view" : "Show diff view"}
                    onclick={() => {
                        if (selectedPath) {
                            selectedPath = null;
                            userClosedDiff = true;
                        } else if (filteredFiles[0]) {
                            openFile(filteredFiles[0].path);
                        }
                    }}
                    disabled={totalChangesCount === 0}
                >
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 5h16v14H4zM13 5v14" />
                    </svg>
                </button> -->
                <button
                    class="workspace-icon-button"
                    aria-label="Search changes"
                    onclick={() => {
                        const input = document.getElementById("changes-search");
                        input?.focus();
                    }}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2.2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                </button>
                <button
                    class="workspace-icon-button"
                    aria-label="Collapse workspace panel"
                    onclick={toggleCollapse}
                >
                    <svg
                        class="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.8"
                            d="M4 5h16v14H4zM16 5v14"
                        />
                    </svg>
                </button>
            </div>
        </div>
    </div>

    <div class="px-4 mb-2">
        <div class="relative flex items-center">
            <input
                id="changes-search"
                type="text"
                bind:value={searchQuery}
                placeholder="Filter files..."
                class="w-full bg-bg-elevated/40 border border-transparent focus:border-border-default rounded-md px-2 py-1 text-[11px] outline-none transition-all placeholder:text-text-muted/60"
            />
            {#if searchQuery}
                <button
                    class="absolute right-2 text-text-tertiary hover:text-text-main"
                    aria-label="Clear search"
                    onclick={() => (searchQuery = "")}
                >
                    <svg
                        class="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12"
                        />
                    </svg>
                </button>
            {/if}
        </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
        {#if filesCount === 0}
            <div class="px-4 py-12 text-center">
                <div class="text-[11px] font-medium text-text-tertiary">
                    {searchQuery ? "No matching files" : "No files modified"}
                </div>
                {#if searchQuery}
                    <button
                        onclick={() => (searchQuery = "")}
                        class="mt-2 text-[10px] text-text-highlight hover:underline"
                        >Clear filter</button
                    >
                {/if}
            </div>
        {:else}
            <div class="flex flex-col">
                {#each filteredFiles as file (file.path)}
                    {@const { dir, name } = splitPath(file.path)}
                    <button
                        type="button"
                        class={`flex w-full items-center px-4 py-1.5 text-left transition-colors group ${
                            selectedPath === file.path
                                ? "bg-bg-elevated"
                                : "hover:bg-bg-hover/50"
                        }`}
                        onclick={() => openFile(file.path)}
                    >
                        <div
                            class="flex-1 min-w-0 flex items-baseline gap-0.5 font-mono text-[12px]"
                        >
                            {#if dir}
                                <span
                                    class="text-text-tertiary truncate select-none"
                                    >{dir}</span
                                >
                            {/if}
                            <span class="text-text-main flex-shrink-0"
                                >{name}</span
                            >
                        </div>
                        <div
                            class="flex items-center gap-2 font-mono text-[11px] ml-3"
                        >
                            <div class="flex items-center gap-1.5">
                                {#if file.added > 0}
                                    <span class="text-text-success"
                                        >+{file.added}</span
                                    >
                                {/if}
                                {#if file.removed > 0}
                                    <span class="text-text-error"
                                        >-{file.removed}</span
                                    >
                                {/if}
                            </div>
                            <div
                                class="w-3.5 h-3.5 rounded-[3px] border border-border-default flex items-center justify-center flex-shrink-0 bg-bg-surface-alt group-hover:border-border-hover transition-colors"
                            >
                                {#if file.added > 0 && file.removed > 0}
                                    <div
                                        class="w-1.5 h-1.5 rounded-[1px] bg-text-highlight"
                                    ></div>
                                {:else if file.added > 0}
                                    <svg
                                        class="w-2.5 h-2.5 text-text-success"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                    >
                                        <path d="M12 5v14M5 12h14" />
                                    </svg>
                                {:else if file.removed > 0}
                                    <svg
                                        class="w-2.5 h-2.5 text-text-error"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                    >
                                        <path d="M5 12h14" />
                                    </svg>
                                {:else}
                                    <div
                                        class="w-1 h-1 rounded-full bg-text-tertiary"
                                    ></div>
                                {/if}
                            </div>
                        </div>
                    </button>
                {/each}
            </div>
        {/if}
    </div>
</aside>

{#if modalOpen && groupedFiles.length > 0}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay/60 p-0 md:p-4 backdrop-blur-[2px]"
        onclick={closeModal}
        role="presentation"
    >
        <div
            class="flex h-full w-full md:h-[min(900px,calc(100vh-4rem))] md:w-[min(1500px,calc(100vw-4rem))] overflow-hidden rounded-none md:rounded-xl bg-bg-surface text-text-main"
            onclick={(event) => event.stopPropagation()}
            role="dialog"
            tabindex="-1"
            aria-label="Workspace Changes"
        >
            <div
                class="flex w-full md:w-72 flex-shrink-0 flex-col border-r border-border-subtle bg-bg-surface-alt {selectedPath
                    ? 'hidden md:flex'
                    : 'flex'}"
            >
                <div
                    class="flex items-center justify-between px-4 py-4 md:py-3 border-b border-border-subtle"
                >
                    <span
                        class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                        >Changes</span
                    >
                    <button
                        type="button"
                        aria-label="Close modal"
                        class="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                        onclick={closeModal}
                    >
                        <svg
                            class="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.8"
                                d="M6 6l12 12M18 6L6 18"
                            ></path>
                        </svg>
                    </button>
                </div>
                <div class="flex-1 overflow-y-auto py-1">
                    <div class="flex flex-col pb-24 md:pb-0">
                        {#each filteredFiles as file (file.path)}
                            {@const { dir, name } = splitPath(file.path)}
                            <button
                                type="button"
                                class={`group flex w-full items-center px-4 py-3 md:py-2 text-left transition-colors ${
                                    selectedPath === file.path
                                        ? "bg-bg-elevated"
                                        : "hover:bg-bg-hover/50"
                                }`}
                                onclick={() => openFile(file.path)}
                            >
                                <div
                                    class="flex-1 min-w-0 flex items-baseline gap-0.5 font-mono text-[12px]"
                                >
                                    {#if dir}<span
                                            class="text-text-tertiary truncate select-none"
                                            >{dir}</span
                                        >{/if}
                                    <span class="text-text-main flex-shrink-0"
                                        >{name}</span
                                    >
                                </div>
                                <div
                                    class="flex items-center gap-2 font-mono text-[11px] ml-3"
                                >
                                    {#if file.added > 0}<span
                                            class="text-text-success"
                                            >+{file.added}</span
                                        >{/if}
                                    {#if file.removed > 0}<span
                                            class="text-text-error"
                                            >-{file.removed}</span
                                        >{/if}
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            </div>

            <div
                class="flex min-w-0 flex-1 flex-col bg-bg-surface {!selectedPath
                    ? 'hidden md:flex'
                    : 'flex'}"
            >
                {@render diffPanel()}
            </div>
        </div>
    </div>
{/if}

<!-- Desktop Expand Button when Collapsed -->
{#if isCollapsed}
    <div class="fixed top-3 right-3 z-30 hidden md:flex pointer-events-none">
        <button
            onclick={toggleCollapse}
            class="pointer-events-auto flex h-8 items-center gap-1.5 px-2.5 rounded-md bg-bg-surface border border-border-default text-text-secondary hover:text-text-main active:scale-95 shadow-sm transition-all"
            aria-label="Expand workspace panel"
        >
            <svg
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 19l-7-7 7-7"
                />
            </svg>
            <span class="text-[10px] font-bold tracking-wider uppercase"
                >Changes</span
            >
        </button>
    </div>
{/if}

<!-- Mobile Toggle Button -->
{#if totalChangesCount > 0 && !sidebarOpen}
    <div class="fixed top-3 right-[52px] z-30 md:hidden pointer-events-none">
        <button
            onclick={() => {
                searchQuery = "";
                selectedPath = null;
                modalOpen = true;
            }}
            class="pointer-events-auto flex h-8 items-center gap-1.5 px-2.5 rounded-md bg-bg-surface border border-border-default text-text-secondary active:scale-95 transition-all"
        >
            <span class="text-[10px] font-bold tracking-wider uppercase"
                >Changes</span
            >
            <span
                class="flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-bg-elevated text-[9px] font-bold text-text-main"
            >
                {totalChangesCount}
            </span>
        </button>
    </div>
{/if}

<style>
    .workspace-action-button {
        display: inline-flex;
        height: 28px;
        align-items: center;
        gap: 6px;
        border-radius: 6px;
        padding: 0 8px;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        transition:
            background-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease;
    }

    .workspace-action-button:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-main);
    }

    .workspace-action-button-primary {
        background: var(--accent);
        color: var(--text-on-accent);
    }

    .workspace-action-button-primary:hover:not(:disabled) {
        background: var(--accent-hover);
        color: var(--text-on-accent);
    }

    .workspace-action-button:disabled {
        cursor: default;
        opacity: 0.35;
    }

    .workspace-icon-button {
        display: inline-flex;
        height: 26px;
        width: 26px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: var(--text-tertiary);
        transition:
            background-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease;
    }

    .workspace-icon-button:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-secondary);
    }

    .workspace-icon-button:disabled {
        cursor: default;
        opacity: 0.3;
    }

    .diff-mobile-scale {
        font-size: var(--mobile-diff-font-size, 11px);
    }

    @media (min-width: 768px) {
        .diff-mobile-scale {
            font-size: 12px;
        }
    }

    /* Creative Slider CSS */
    .creative-slider {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        outline: none;
        z-index: 10;
    }
    .creative-slider::-webkit-slider-runnable-track {
        height: 100%;
        background: transparent;
    }
    .creative-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 24px;
        background: var(--text-main);
        border-radius: 4px;
        cursor: pointer;
        border: 2px solid var(--bg-surface);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        margin-top: 0;
    }
    .creative-slider::-moz-range-track {
        height: 100%;
        background: transparent;
    }
    .creative-slider::-moz-range-thumb {
        width: 14px;
        height: 24px;
        background: var(--text-main);
        border-radius: 4px;
        cursor: pointer;
        border: 2px solid var(--bg-surface);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
</style>
