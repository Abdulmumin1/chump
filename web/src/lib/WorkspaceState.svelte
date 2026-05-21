<script lang="ts">
    import { browser } from "$app/environment";
    import { tick } from "svelte";
    import { DIFFS_TAG_NAME, FileDiff, processPatch } from "@pierre/diffs";
    // @ts-ignore side-effect web-component bundle is not typed
    import "../../node_modules/@pierre/diffs/dist/components/web-components.js";
    import type { ChangeRecord, ChumpState } from "$lib/chump/types";
    import {
        getDocumentTheme,
        observeDocumentTheme,
        type AppTheme,
    } from "$lib/theme";

    let { state: sessionState, sidebarOpen = false } = $props<{
        state: ChumpState | null;
        sidebarOpen?: boolean;
    }>();

    let modalOpen = $state(false);
    let selectedPath: string | null = $state(null);
    let searchQuery = $state("");
    let mobileDiffFontSize = $state(11);
    let diffHosts: HTMLElement[] = [];
    let diffInstances: FileDiff[] = [];
    let appTheme = $state<AppTheme>(getDocumentTheme());

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

    let selectedFile = $derived(
        filteredFiles.find((file) => file.path === selectedPath) ?? null,
    );
    let selectedFileIndex = $derived(
        selectedPath
            ? filteredFiles.findIndex((file) => file.path === selectedPath)
            : -1,
    );
    let selectedRecordPatches = $derived.by(() =>
        (selectedFile?.records ?? []).map(toUnifiedPatch),
    );
    let selectedRecordDiffFiles = $derived.by(() =>
        selectedRecordPatches.map((patch) => {
            if (!patch) return [];
            try {
                return processPatch(patch, "workspace-state", false).files;
            } catch {
                return [];
            }
        }),
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
        if (window.innerWidth > 768 && !selectedPath && filteredFiles.length > 0) {
            selectedPath = filteredFiles[0].path;
        }
    });

    function buildFileGroups(currentState: ChumpState | null): FileGroup[] {
        const grouped = new Map<string, FileGroup>();
        const changeRecords = normalizeChangeRecords(currentState?.change_records);

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
        modalOpen = true;
    }

    function closeModal(): void {
        modalOpen = false;
    }

    function selectPreviousFile(): void {
        if (selectedFileIndex <= 0) return;
        selectedPath = filteredFiles[selectedFileIndex - 1]?.path ?? selectedPath;
    }

    function selectNextFile(): void {
        if (selectedFileIndex < 0 || selectedFileIndex >= filteredFiles.length - 1)
            return;
        selectedPath = filteredFiles[selectedFileIndex + 1]?.path ?? selectedPath;
    }

    function cleanupDiffs(): void {
        for (const instance of diffInstances) {
            instance.cleanUp();
        }
        diffInstances = [];
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
        const afterPath =
            record.kind === "delete" ? "/dev/null" : nextPath;

        return [`--- ${prevPath}`, `+++ ${afterPath}`, ...body].join("\n");
    }

    $effect(() => {
        appTheme;
        if (!browser || !modalOpen || !selectedFile) {
            cleanupDiffs();
            return;
        }

        const diffGroups = selectedRecordDiffFiles;
        void tick().then(() => {
            cleanupDiffs();

            diffInstances = diffGroups.flatMap((files, recordIndex) => {
                return files.flatMap((file, fileIndex) => {
                    const host = diffHosts[recordIndex * 8 + fileIndex];
                    if (!host) return [];

                    const instance = new FileDiff({
                        theme: {
                            dark: "pierre-dark",
                            light: "pierre-light",
                        },
                        themeType: appTheme,
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
        });

        return () => {
            cleanupDiffs();
        };
    });
</script>

<aside class="hidden md:flex h-full w-80 flex-shrink-0 flex-col border-l border-border-subtle bg-bg-surface-alt text-text-main transition-all">
    <div class="px-4 py-2.5">
        <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-bg-elevated transition-colors">
                <span class="text-[11px] font-semibold text-text-main">Changes</span>
                <span class="text-[11px] text-text-tertiary font-medium">{totalChangesCount}</span>
            </div>
            <div class="flex-1"></div>
            <div class="flex items-center gap-2.5 text-text-tertiary">
                <button 
                    class="hover:text-text-secondary transition-colors"
                    aria-label="Search changes"
                    onclick={() => {
                        const input = document.getElementById('changes-search');
                        input?.focus();
                    }}
                >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
                    onclick={() => searchQuery = ""}
                >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            {/if}
        </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
        {#if filesCount === 0}
            <div class="px-4 py-12 text-center">
                <div class="text-[11px] font-medium text-text-tertiary">
                    {searchQuery ? 'No matching files' : 'No files modified'}
                </div>
                {#if searchQuery}
                    <button 
                        onclick={() => searchQuery = ""}
                        class="mt-2 text-[10px] text-text-highlight hover:underline"
                    >Clear filter</button>
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
                        <div class="flex-1 min-w-0 flex items-baseline gap-0.5 font-mono text-[12px]">
                            {#if dir}
                                <span class="text-text-tertiary truncate select-none">{dir}</span>
                            {/if}
                            <span class="text-text-main flex-shrink-0">{name}</span>
                        </div>
                        <div class="flex items-center gap-2 font-mono text-[11px] ml-3">
                            <div class="flex items-center gap-1.5">
                                {#if file.added > 0}
                                    <span class="text-text-success">+{file.added}</span>
                                {/if}
                                {#if file.removed > 0}
                                    <span class="text-text-error">-{file.removed}</span>
                                {/if}
                            </div>
                            <div class="w-3.5 h-3.5 rounded-[3px] border border-border-default flex items-center justify-center flex-shrink-0 bg-bg-surface-alt group-hover:border-border-hover transition-colors">
                                {#if file.added > 0 && file.removed > 0}
                                    <div class="w-1.5 h-1.5 rounded-[1px] bg-text-highlight"></div>
                                {:else if file.added > 0}
                                    <svg class="w-2.5 h-2.5 text-text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                        <path d="M12 5v14M5 12h14" />
                                    </svg>
                                {:else if file.removed > 0}
                                    <svg class="w-2.5 h-2.5 text-text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                        <path d="M5 12h14" />
                                    </svg>
                                {:else}
                                    <div class="w-1 h-1 rounded-full bg-text-tertiary"></div>
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
            <div class="flex w-full md:w-72 flex-shrink-0 flex-col border-r border-border-subtle bg-bg-surface-alt {selectedPath ? 'hidden md:flex' : 'flex'}">
                <div class="flex items-center justify-between px-4 py-4 md:py-3 border-b border-border-subtle">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Changes</span>
                <button
                    type="button"
                    aria-label="Close modal"
                    class="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                    onclick={closeModal}
                >
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 6l12 12M18 6L6 18"></path>
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
                                    selectedPath === file.path ? "bg-bg-elevated" : "hover:bg-bg-hover/50"
                                }`}
                                onclick={() => { selectedPath = file.path; }}
                        >
                            <div class="flex-1 min-w-0 flex items-baseline gap-0.5 font-mono text-[12px]">
                                {#if dir}<span class="text-text-tertiary truncate select-none">{dir}</span>{/if}
                                <span class="text-text-main flex-shrink-0">{name}</span>
                            </div>
                            <div class="flex items-center gap-2 font-mono text-[11px] ml-3">
                                {#if file.added > 0}<span class="text-text-success">+{file.added}</span>{/if}
                                {#if file.removed > 0}<span class="text-text-error">-{file.removed}</span>{/if}
                            </div>
                        </button>
                    {/each}
                </div>
            </div>
        </div>

        <div class="flex min-w-0 flex-1 flex-col bg-bg-surface {!selectedPath ? 'hidden md:flex' : 'flex'}">
            <div class="flex items-center justify-between border-b border-border-subtle px-4 md:px-6 py-2 md:py-3">
                <div class="flex items-center gap-3 min-w-0">
                    <button 
                        class="md:hidden p-1 -ml-2 text-text-tertiary active:bg-bg-hover rounded-full"
                        aria-label="Back to file list"
                        onclick={() => selectedPath = null}
                    >
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div class="truncate font-mono text-[11px] md:text-[13px] font-medium text-text-main">
                        {selectedFile?.path ?? ""}
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="md:hidden text-[10px] text-text-tertiary font-mono tabular-nums">
                        {selectedFileIndex >= 0 ? selectedFileIndex + 1 : 0}/{filteredFiles.length}
                    </div>
                    <button
                        type="button"
                        class="md:hidden h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-tertiary disabled:opacity-35"
                        onclick={selectPreviousFile}
                        disabled={selectedFileIndex <= 0}
                        aria-label="Previous changed file"
                    >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        class="md:hidden h-7 w-7 flex items-center justify-center rounded border border-border-default text-text-tertiary disabled:opacity-35"
                        onclick={selectNextFile}
                        disabled={selectedFileIndex < 0 || selectedFileIndex >= filteredFiles.length - 1}
                        aria-label="Next changed file"
                    >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <div class="flex items-center gap-3 font-mono text-[12px]">
                        {#if (selectedFile?.added ?? 0) > 0}<span class="text-text-success">+{selectedFile?.added}</span>{/if}
                        {#if (selectedFile?.removed ?? 0) > 0}<span class="text-text-error">-{selectedFile?.removed}</span>{/if}
                    </div>
                </div>
            </div>

            {#if selectedFile}
                <div class="md:hidden flex flex-col gap-3 border-b border-border-subtle px-5 py-3">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Text Size</span>
                        <button
                            type="button"
                            class="text-[10px] font-mono text-text-tertiary hover:text-text-main transition-colors"
                            onclick={() => (mobileDiffFontSize = 11)}
                        >
                            Reset
                        </button>
                    </div>
                    <div class="relative w-full h-6 flex items-center">
                        <!-- Ruler marks -->
                        <div class="absolute inset-0 flex items-center justify-between px-[7px] pointer-events-none">
                            {#each Array(21) as _, i}
                                {@const val = 9 + (i / 4)}
                                <div class="w-[1.5px] rounded-full transition-colors duration-150 {i % 4 === 0 ? 'h-3.5' : 'h-1.5'} {mobileDiffFontSize >= val ? 'bg-text-main' : 'bg-border-default'}"></div>
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

            <div class="min-h-0 flex-1 overflow-y-auto bg-bg-surface-alt/10 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-0">
                {#if !selectedFile || selectedFile.records.length === 0}
                    <div class="flex h-full items-center justify-center text-[13px] text-text-tertiary">
                        Summary counts available. Full diffs for new edits.
                    </div>
                {:else}
                    <div class="flex flex-col">
                        {#each selectedFile.records as record, index (`${selectedFile.path}-${index}`)}
                            <section class="border-b border-border-subtle last:border-b-0">
                                <div class="flex items-center justify-between bg-bg-elevated/40 px-6 py-1.5 border-b border-border-subtle">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                                        {describeKind(record)}
                                    </div>
                                </div>
                                {#if selectedRecordDiffFiles[index] && selectedRecordDiffFiles[index].length > 0}
                                    {#each selectedRecordDiffFiles[index] as fileDiff, fileIndex (`${fileDiff.name}-${fileIndex}`)}
                                        <div class="overflow-hidden bg-bg-code-block">
                                            <svelte:element
                                                this={DIFFS_TAG_NAME}
                                                bind:this={diffHosts[index * 8 + fileIndex]}
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
                                        <table class="w-full border-collapse">
                                            <tbody>
                                                {#each buildRows(record) as row (`${row.kind}-${row.oldLine ?? ""}-${row.newLine ?? ""}-${row.text}`)}
                                                    <tr class="{lineClass(row.kind)} hover:bg-bg-hover/20 transition-colors group">
                                                        <td class="w-8 md:w-10 select-none pr-2 md:pr-3 text-right text-text-tertiary/30 border-r border-border-subtle/30">{row.oldLine ?? ""}</td>
                                                        <td class="w-8 md:w-10 select-none pr-2 md:pr-3 text-right text-text-tertiary/30 border-r border-border-subtle/30">{row.newLine ?? ""}</td>
                                                        <td class="whitespace-pre px-3 md:px-4">{row.text}</td>
                                                    </tr>
                                                {/each}
                                            </tbody>
                                        </table>
                                    </div>
                                {/if}
                            </section>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
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
            <span class="text-[10px] font-bold tracking-wider uppercase">Changes</span>
            <span class="flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-bg-elevated text-[9px] font-bold text-text-main">
                {totalChangesCount}
            </span>
        </button>
    </div>
{/if}

<style>
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
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
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
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
</style>
