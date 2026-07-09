<script lang="ts">
    import { slide } from "svelte/transition";
    import MarkdownText from "$lib/MarkdownText.svelte";
    import ToolBlock from "$lib/ToolBlock.svelte";
    import type { TranscriptBlock, TranscriptMessage } from "$lib/chat/types";

    let {
        item,
        expandedBlocks,
        onToggleBlock,
    } = $props<{
        item: TranscriptMessage;
        expandedBlocks: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
    }>();

    type BlockGroup =
        | { kind: "single"; block: TranscriptBlock; index: number }
        | { kind: "tools"; blocks: Array<{ block: TranscriptBlock; index: number }> };

    let expandedToolGroups = $state<Record<string, boolean>>({});

    let blockGroups = $derived.by(() => groupBlocks(item.blocks));

    function isToolBlock(block: TranscriptBlock): boolean {
        return block.kind === "tool-call" || block.kind === "tool-result";
    }

    function canCollapseToolBlock(block: TranscriptBlock): boolean {
        return (
            isToolBlock(block) &&
            (block.status === "completed" ||
                block.status === "error" ||
                block.status === "aborted" ||
                block.hasResult === true)
        );
    }

    function groupBlocks(blocks: TranscriptBlock[]): BlockGroup[] {
        const groups: BlockGroup[] = [];
        let index = 0;

        while (index < blocks.length) {
            const block = blocks[index];
            if (!canCollapseToolBlock(block)) {
                groups.push({ kind: "single", block, index });
                index += 1;
                continue;
            }

            const toolBlocks: Array<{ block: TranscriptBlock; index: number }> = [];
            while (index < blocks.length && canCollapseToolBlock(blocks[index])) {
                toolBlocks.push({ block: blocks[index], index });
                index += 1;
            }

            if (toolBlocks.length > 1) {
                groups.push({ kind: "tools", blocks: toolBlocks });
            } else {
                groups.push({ kind: "single", block: toolBlocks[0].block, index: toolBlocks[0].index });
            }
        }

        return groups;
    }

    function groupKey(group: Extract<BlockGroup, { kind: "tools" }>): string {
        return `${item.id}-tools-${group.blocks[0].index}`;
    }

    function isGroupExpanded(group: Extract<BlockGroup, { kind: "tools" }>): boolean {
        return expandedToolGroups[groupKey(group)] ?? false;
    }

    function toggleToolGroup(group: Extract<BlockGroup, { kind: "tools" }>) {
        const key = groupKey(group);
        expandedToolGroups[key] = !(expandedToolGroups[key] ?? false);
    }

    function toolLabel(block: TranscriptBlock): string {
        if (block.originalToolName === "bash" || block.originalToolName === "execute_command") return "$";
        if (block.originalToolName === "read_file" || block.originalToolName === "view_file") return "Read file";
        if (block.originalToolName === "view_image") return "View image";
        if (block.originalToolName === "write_file" || block.originalToolName === "create_file") return "Write file";
        if (block.originalToolName === "apply_patch") return "Edited";
        if (block.originalToolName === "search") return "Search";
        if (block.originalToolName === "website" || block.originalToolName === "web_search" || block.originalToolName === "web_fetch") return "Web";
        if (block.originalToolName === "skill" || block.originalToolName === "load_skill") return "Skill";
        return block.originalToolName || block.toolName || "tool";
    }

    function toolPreview(block: TranscriptBlock): string {
        if (block.originalToolName === "bash" || block.originalToolName === "execute_command") {
            return (block.toolName || "").replace("$ ", "");
        }
        return block.toolName && block.toolName !== block.originalToolName ? block.toolName : "";
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
        return `${count} action${count === 1 ? "" : "s"}`;
    }

    function groupSummary(group: Extract<BlockGroup, { kind: "tools" }>): string {
        const counts = new Map<string, number>();
        for (const { block } of group.blocks) {
            const kind = toolSummaryKind(block);
            counts.set(kind, (counts.get(kind) ?? 0) + 1);
        }

        return [...counts.entries()]
            .map(([kind, count]) => formatSummaryPart(kind, count))
            .join(", ");
    }

    function groupPreview(group: Extract<BlockGroup, { kind: "tools" }>): string {
        return group.blocks
            .map(({ block }) => toolPreview(block))
            .filter(Boolean)
            .slice(0, 3)
            .join(", ");
    }
</script>

<div class="flex flex-col min-w-0 {item.live ? 'opacity-90' : ''}">
    {#each blockGroups as group, groupIndex (`${item.id}-${group.kind}-${group.kind === 'single' ? group.index : group.blocks[0].index}`)}
        <div class={groupIndex > 0 ? "mt-2" : ""}>
        {#if group.kind === "single"}
            {@const block = group.block}
            {@const index = group.index}
            {#if block.kind === "text" && block.text.trim()}
                <div class="px-2">
                    <MarkdownText text={block.text} />
                </div>
            {:else if block.kind === "tool-call" || block.kind === "tool-result"}
                <ToolBlock
                    {block}
                    expanded={expandedBlocks[`${item.id}-${index}`]}
                    onToggle={() => onToggleBlock(`${item.id}-${index}`)}
                />
            {:else if block.kind === "image"}
                <div
                    class="p-3 bg-bg-code border border-border-default rounded-md text-[12px] text-text-tertiary inline-flex items-center gap-2 w-fit"
                >
                    <svg
                        class="w-4 h-4"
                        aria-hidden="true"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        ></path></svg
                    >
                    {block.text}
                </div>
            {/if}
        {:else}
            <button
                class="group flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 transition-colors hover:bg-bg-elevated focus:outline-none"
                onclick={() => toggleToolGroup(group)}
            >
                <div class="flex min-w-0 items-center gap-3 overflow-hidden">
                    <span class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight">{groupSummary(group)}</span>
                    {#if groupPreview(group)}
                        <span class="min-w-0 truncate font-mono text-[11px] text-text-secondary">{groupPreview(group)}</span>
                    {/if}
                </div>
                <svg
                    class="ml-4 h-4 w-4 flex-shrink-0 text-text-tertiary opacity-80 transition-transform duration-200 group-hover:opacity-100 {isGroupExpanded(group)
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
            </button>

            {#if isGroupExpanded(group)}
                <div transition:slide={{ duration: 160 }} class="mt-1.5 space-y-2 pl-4">
                    {#each group.blocks as { block, index } (`${item.id}-${index}`)}
                        <ToolBlock
                            {block}
                            expanded={expandedBlocks[`${item.id}-${index}`]}
                            onToggle={() => onToggleBlock(`${item.id}-${index}`)}
                        />
                    {/each}
                </div>
            {/if}
        {/if}
        </div>
    {/each}
</div>
