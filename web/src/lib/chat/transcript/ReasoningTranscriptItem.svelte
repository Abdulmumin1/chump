<script lang="ts">
    import ReasoningBlock from "$lib/chat/transcript/ReasoningBlock.svelte";
    import type { TranscriptBlock, TranscriptMessage } from "$lib/chat/types";

    let {
        item,
        itemIndex,
        transcriptLength,
        expandedReasoning,
        isSending,
        onToggleReasoning,
        reasoningSummary,
    } = $props<{
        item: TranscriptMessage;
        itemIndex: number;
        transcriptLength: number;
        expandedReasoning: Record<string, boolean>;
        isSending: boolean;
        onToggleReasoning: (id: string, defaultExpanded?: boolean) => void;
        reasoningSummary: (text: string) => string;
    }>();

    function isReasoningBlock(block: TranscriptBlock): boolean {
        return (
            (block.kind === "text" || block.kind === "reasoning") &&
            block.text.trim().length > 0
        );
    }
</script>

<div class="min-w-0 w-full">
    {#each item.blocks as block, index (`${item.id}-${index}`)}
        {#if isReasoningBlock(block)}
            <ReasoningBlock
                id={`${item.id}-${index}`}
                text={block.text}
                active={isSending && itemIndex === transcriptLength - 1 && index === item.blocks.length - 1}
                streaming={item.live === true}
                expanded={expandedReasoning[`${item.id}-${index}`]}
                onToggle={onToggleReasoning}
                summary={reasoningSummary}
            />
        {/if}
    {/each}
</div>
