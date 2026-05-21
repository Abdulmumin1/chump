<script lang="ts">
    import MarkdownText from "$lib/MarkdownText.svelte";
    import { slide } from "svelte/transition";
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
        onToggleReasoning: (id: string) => void;
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
            <div class="p-2 transition-colors hover:bg-bg-code-block/60 min-w-0">
                <button
                    class="flex w-full min-w-0 items-center justify-between gap-4 text-left focus:outline-none"
                    onclick={() => onToggleReasoning(`${item.id}-${index}`)}
                >
                    <div
                        class="mb-2 flex min-w-0 items-center gap-3 text-text-secondary"
                    >
                        <svg
                            class="h-5 w-5 flex-shrink-0 text-text-highlight"
                            aria-hidden="true"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.7"
                                d="M9.663 17h4.673M12 3c-3.866 0-7 3.134-7 7 0 2.252 1.064 4.255 2.716 5.537.513.398.86 1.005.984 1.643L9 19h6l.3-1.82c.124-.638.47-1.245.984-1.643A6.972 6.972 0 0019 10c0-3.866-3.134-7-7-7z"
                            ></path></svg
                        >
                        <span
                            class="min-w-0 break-words text-[14px] font-medium tracking-tight text-text-secondary"
                            >{reasoningSummary(block.text)}</span
                        >
                    </div>
                    <svg
                        class="h-4 w-4 flex-shrink-0 text-text-tertiary transition-transform duration-200 {(expandedReasoning[
                            `${item.id}-${index}`
                        ] ??
                        (isSending && itemIndex === transcriptLength - 1))
                            ? 'rotate-180'
                            : '-rotate-90'}"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                        ></path></svg
                    >
                </button>
                {#if expandedReasoning[`${item.id}-${index}`] ?? (isSending && itemIndex === transcriptLength - 1)}
                    <div transition:slide={{ duration: 200 }} class="p-2">
                        <MarkdownText
                            text={block.text}
                            classes="text-[12px] text-text-secondary"
                        />
                    </div>
                {/if}
            </div>
        {/if}
    {/each}
</div>
