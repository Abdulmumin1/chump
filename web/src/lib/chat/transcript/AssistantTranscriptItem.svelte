<script lang="ts">
    import { slide } from "svelte/transition";
    import MarkdownText from "$lib/MarkdownText.svelte";
    import ToolBlock from "$lib/ToolBlock.svelte";
    import {
        nextToolPresentationDeadline,
        summarizeTerminalActivity,
        toolPresentation,
    } from "$lib/chat/activity-summary";
    import ReasoningBlock from "$lib/chat/transcript/ReasoningBlock.svelte";
    import { isTerminalActivityBlock } from "$lib/chat/transcript";
    import type { TranscriptBlock, TranscriptMessage } from "$lib/chat/types";

    let {
        item,
        active,
        expandedBlocks,
        expandedReasoning,
        onToggleBlock,
        onToggleReasoning,
        reasoningSummary,
    } = $props<{
        item: TranscriptMessage;
        active: boolean;
        expandedBlocks: Record<string, boolean>;
        expandedReasoning: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
        onToggleReasoning: (id: string, defaultExpanded?: boolean) => void;
        reasoningSummary: (...texts: string[]) => string;
    }>();

    type BlockGroup =
        | { kind: "single"; block: TranscriptBlock; index: number }
        | { kind: "activity"; blocks: Array<{ block: TranscriptBlock; index: number }> };

    let expandedActivityGroups = $state<Record<string, boolean>>({});
    let presentationNow = $state(Date.now());

    let blockGroups = $derived.by(() => groupBlocks(item.blocks, active));

    $effect(() => {
        const current = presentationNow;
        let deadline: number | undefined;
        for (const block of item.blocks as TranscriptBlock[]) {
            const next = nextToolPresentationDeadline(block, current);
            if (next === undefined) continue;
            deadline = deadline === undefined ? next : Math.min(deadline, next);
        }
        if (deadline === undefined) return;

        const timer = setTimeout(
            () => {
                presentationNow = Date.now();
            },
            Math.max(0, deadline - Date.now() + 16),
        );
        return () => clearTimeout(timer);
    });

    function groupBlocks(blocks: TranscriptBlock[], isActive: boolean): BlockGroup[] {
        const groups: BlockGroup[] = [];
        let index = 0;

        while (index < blocks.length) {
            const block = blocks[index];
            if (toolPresentation(block, presentationNow) === "hidden") {
                index += 1;
                continue;
            }
            const isActiveReasoning =
                isActive &&
                index === blocks.length - 1 &&
                block.kind === "reasoning";
            if (isActiveReasoning || !isCollapsibleActivityBlock(block)) {
                groups.push({ kind: "single", block, index });
                index += 1;
                continue;
            }

            const activityBlocks: Array<{ block: TranscriptBlock; index: number }> = [];
            while (
                index < blocks.length &&
                !(isActive && index === blocks.length - 1 && blocks[index].kind === "reasoning") &&
                isCollapsibleActivityBlock(blocks[index])
            ) {
                activityBlocks.push({ block: blocks[index], index });
                index += 1;
            }

            if (
                activityBlocks.length > 1 ||
                activityBlocks.some(
                    ({ block: activityBlock }) =>
                        activityBlock.kind === "tool-call" ||
                        activityBlock.kind === "tool-result",
                )
            ) {
                groups.push({ kind: "activity", blocks: activityBlocks });
            } else {
                groups.push({ kind: "single", block: activityBlocks[0].block, index: activityBlocks[0].index });
            }
        }

        return groups;
    }

    function isCollapsibleActivityBlock(block: TranscriptBlock): boolean {
        if (!isTerminalActivityBlock(block)) return false;
        if (block.kind === "reasoning") return true;
        return toolPresentation(block, presentationNow) === "collapsible";
    }

    function groupKey(group: Extract<BlockGroup, { kind: "activity" }>): string {
        return `${item.id}-activity-${group.blocks[0].index}`;
    }

    function isGroupExpanded(group: Extract<BlockGroup, { kind: "activity" }>): boolean {
        return expandedActivityGroups[groupKey(group)] ?? false;
    }

    function toggleActivityGroup(group: Extract<BlockGroup, { kind: "activity" }>) {
        const key = groupKey(group);
        expandedActivityGroups[key] = !(expandedActivityGroups[key] ?? false);
    }

    function groupSummary(group: Extract<BlockGroup, { kind: "activity" }>) {
        return summarizeTerminalActivity(
            group.blocks.map(({ block }) => block),
            reasoningSummary,
        );
    }
</script>

<div class="flex flex-col min-w-0 {item.live ? 'opacity-90' : ''}">
    {#each blockGroups as group, groupIndex (`${item.id}-${group.kind === 'single' ? group.index : group.blocks[0].index}`)}
        <div class={`${groupIndex > 0 ? "mt-2" : ""} min-h-[36px]`}>
        {#if group.kind === "single"}
            {@const block = group.block}
            {@const index = group.index}
            {#if block.kind === "text" && block.text.trim()}
                <div class="px-2">
                    <MarkdownText text={block.text} streaming={item.live === true} />
                </div>
            {:else if block.kind === "tool-call" || block.kind === "tool-result"}
                <ToolBlock
                    {block}
                    expanded={expandedBlocks[`${item.id}-${index}`]}
                    onToggle={() => onToggleBlock(`${item.id}-${index}`)}
                />
            {:else if block.kind === "reasoning"}
                <ReasoningBlock
                    id={`${item.id}-${index}`}
                    text={block.text}
                    active={active && index === item.blocks.length - 1}
                    expanded={expandedReasoning[`${item.id}-${index}`]}
                    onToggle={onToggleReasoning}
                    summary={reasoningSummary}
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
            {@const summary = groupSummary(group)}
            <div class="flex w-full items-center gap-3 py-1.5">
                <span class="h-px min-w-4 flex-1 bg-border-default"></span>
                <button
                    class="group flex shrink-0 items-center gap-1.5 px-1 text-text-secondary transition-colors hover:text-text-main focus:outline-none"
                    onclick={() => toggleActivityGroup(group)}
                    type="button"
                    aria-expanded={isGroupExpanded(group)}
                >
                    <span class="font-mono text-[12px] font-medium">{summary.text}</span>
                    <svg
                        class="size-3.5 transition-transform duration-200 {isGroupExpanded(group) ? 'rotate-90' : ''}"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </button>
                <span class="h-px min-w-4 flex-1 bg-border-default"></span>
            </div>

            {#if isGroupExpanded(group)}
                <div transition:slide={{ duration: 160 }} class="mt-1.5 space-y-2 pl-4">
                    {#each group.blocks as { block, index } (`${item.id}-${index}`)}
                        {#if block.kind === "reasoning"}
                            <ReasoningBlock
                                id={`${item.id}-${index}`}
                                text={block.text}
                                expanded={expandedReasoning[`${item.id}-${index}`]}
                                onToggle={onToggleReasoning}
                                summary={reasoningSummary}
                            />
                        {:else}
                            <ToolBlock
                                {block}
                                expanded={expandedBlocks[`${item.id}-${index}`]}
                                onToggle={() => onToggleBlock(`${item.id}-${index}`)}
                            />
                        {/if}
                    {/each}
                </div>
            {/if}
        {/if}
        </div>
    {/each}
</div>
