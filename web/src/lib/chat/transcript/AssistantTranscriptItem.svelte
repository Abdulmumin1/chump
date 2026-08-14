<script lang="ts">
    import { flip } from "svelte/animate";
    import { slide } from "svelte/transition";
    import MarkdownText from "$lib/MarkdownText.svelte";
    import ToolBlock from "$lib/ToolBlock.svelte";
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

    let blockGroups = $derived.by(() => groupBlocks(item.blocks, active));

    function groupBlocks(blocks: TranscriptBlock[], isActive: boolean): BlockGroup[] {
        const groups: BlockGroup[] = [];
        let index = 0;

        while (index < blocks.length) {
            const block = blocks[index];
            const isActiveReasoning =
                isActive &&
                index === blocks.length - 1 &&
                block.kind === "reasoning";
            if (isActiveReasoning || !isTerminalActivityBlock(block)) {
                groups.push({ kind: "single", block, index });
                index += 1;
                continue;
            }

            const activityBlocks: Array<{ block: TranscriptBlock; index: number }> = [];
            while (
                index < blocks.length &&
                !(isActive && index === blocks.length - 1 && blocks[index].kind === "reasoning") &&
                isTerminalActivityBlock(blocks[index])
            ) {
                activityBlocks.push({ block: blocks[index], index });
                index += 1;
            }

            if (activityBlocks.length > 1) {
                groups.push({ kind: "activity", blocks: activityBlocks });
            } else {
                groups.push({ kind: "single", block: activityBlocks[0].block, index: activityBlocks[0].index });
            }
        }

        return groups;
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

    function toolPreview(block: TranscriptBlock): string {
        if (block.originalToolName === "bash" || block.originalToolName === "execute_command") {
            return (block.toolName || "").replace("$ ", "");
        }
        if (block.originalToolName === "mcp") {
            const server = String(block.args?.server ?? "");
            const tool = String(block.args?.tool_name ?? "");
            const query = String(block.args?.query ?? "");
            return [server, tool].filter(Boolean).join(" / ") || query;
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
        if (block.originalToolName === "mcp") return "MCP";
        if (block.originalToolName === "list_sessions" || block.originalToolName === "inspect_session" || block.originalToolName === "start_session") return "session";
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
        if (kind === "MCP") return `Used MCP ${count} time${count === 1 ? "" : "s"}`;
        if (kind === "session") return `Used ${count} session tool${count === 1 ? "" : "s"}`;
        return `${count} action${count === 1 ? "" : "s"}`;
    }

    function groupSummary(group: Extract<BlockGroup, { kind: "activity" }>): string {
        const counts: Record<string, number> = {};
        const orderedKinds: string[] = [];
        const reasoningText: string[] = [];

        for (const { block } of group.blocks) {
            if (block.kind === "reasoning") {
                reasoningText.push(block.text);
                continue;
            }
            const kind = toolSummaryKind(block);
            if (!(kind in counts)) {
                orderedKinds.push(kind);
            }
            counts[kind] = (counts[kind] ?? 0) + 1;
        }

        const toolParts = orderedKinds.map((kind) =>
            formatSummaryPart(kind, counts[kind]),
        );
        const thoughtPart = reasoningText.length > 0
            ? [reasoningSummary(...reasoningText)]
            : [];
        return [...thoughtPart, ...toolParts].join(", ");
    }

    function groupPreview(group: Extract<BlockGroup, { kind: "activity" }>): string {
        return group.blocks
            .map(({ block }) => toolPreview(block))
            .filter(Boolean)
            .slice(0, 3)
            .join(", ");
    }
</script>

<div class="flex flex-col min-w-0 {item.live ? 'opacity-90' : ''}">
    {#each blockGroups as group, groupIndex (`${item.id}-${group.kind === 'single' ? group.index : group.blocks[0].index}`)}
        <div
            class={`${groupIndex > 0 ? "mt-2" : ""} min-h-[36px]`}
            animate:flip={{ duration: 180 }}
            out:slide={{ duration: 180 }}
        >
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
            <button
                class="group flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 transition-colors hover:bg-bg-elevated focus:outline-none"
                onclick={() => toggleActivityGroup(group)}
            >
                <div class="flex min-w-0 items-center gap-3 overflow-hidden">
                    <span class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-secondary">{groupSummary(group)}</span>
                    {#if groupPreview(group)}
                        <span class="min-w-0 truncate font-mono text-[11px] text-text-secondary">{groupPreview(group)}</span>
                    {/if}
                </div>
            </button>

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
