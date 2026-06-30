<script lang="ts">
    import MarkdownText from "$lib/MarkdownText.svelte";
    import ToolBlock from "$lib/ToolBlock.svelte";
    import type { TranscriptMessage } from "$lib/chat/types";

    let {
        item,
        expandedBlocks,
        onToggleBlock,
    } = $props<{
        item: TranscriptMessage;
        expandedBlocks: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
    }>();
</script>

<div class="flex flex-col min-w-0 {item.live ? 'opacity-90' : ''}">
    {#each item.blocks as block, index (`${item.id}-${index}`)}
        {@const prevBlock = index > 0 ? item.blocks[index - 1] : null}
        {@const isTool = block.kind === "tool-call" || block.kind === "tool-result"}
        {@const prevIsTool = prevBlock?.kind === "tool-call" || prevBlock?.kind === "tool-result"}
        {@const isConsecutiveTool = isTool && prevIsTool}
        <div class={index > 0 ? (isConsecutiveTool ? "mt-0.5" : "mt-2") : ""}>
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
        </div>
    {/each}
</div>
