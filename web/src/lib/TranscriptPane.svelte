<script lang="ts">
    import UserMessage from "$lib/UserMessage.svelte";
    import AssistantTranscriptItem from "$lib/chat/transcript/AssistantTranscriptItem.svelte";
    import ReasoningTranscriptItem from "$lib/chat/transcript/ReasoningTranscriptItem.svelte";
    import TranscriptEmptyState from "$lib/chat/transcript/TranscriptEmptyState.svelte";
    import type { TranscriptMessage } from "$lib/chat/types";
    import type { ChumpHealth } from "$lib/chump/types";

    let {
        transcript,
        transcriptElement = $bindable(),
        isSending,
        isConnecting = false,
        expandedBlocks,
        expandedReasoning,
        onToggleBlock,
        onToggleReasoning,
        reasoningSummary,
        health = null,
        activeSessionId = "",
        onOpenConnectModal,
        isLoadingSession = false,
    } = $props<{
        transcript: TranscriptMessage[];
        transcriptElement: HTMLDivElement | null;
        isSending: boolean;
        isConnecting?: boolean;
        expandedBlocks: Record<string, boolean>;
        expandedReasoning: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
        onToggleReasoning: (id: string, defaultExpanded?: boolean) => void;
        reasoningSummary: (text: string) => string;
        health?: ChumpHealth | null;
        activeSessionId?: string;
        onOpenConnectModal?: () => void;
        isLoadingSession?: boolean;
    }>();

    function isToolBlock(item: TranscriptMessage, edge: "first" | "last"): boolean {
        const block = edge === "first" ? item.blocks[0] : item.blocks.at(-1);
        return block?.kind === "tool-call" || block?.kind === "tool-result";
    }

    function itemSpacing(index: number): string {
        if (index === 0) return "";
        const current = transcript[index];
        const previous = transcript[index - 1];
        if (!current || !previous) return "";

        if (isToolBlock(current, "first") && isToolBlock(previous, "last")) {
            return "mt-0.5";
        }
        if (current.role === "reasoning") return "mt-5";
        if (isToolBlock(current, "first") && previous.role === "reasoning") {
            return "mt-1";
        }
        if (current.role === "user") return "mt-6";
        return "mt-5";
    }
</script>

<div
    class="flex-1 overflow-y-auto p-4 md:p-8"
    bind:this={transcriptElement}
    style="mask-image: linear-gradient(to bottom, transparent 0, black 80px, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 80px, black 100%);"
>
    <div
        class="max-w-4xl mx-auto flex flex-col gap-0 {transcript.length > 0
            ? 'pt-10 md:pt-12'
            : ''}"
    >
        {#if transcript.length === 0}
            <TranscriptEmptyState
                {health}
                {activeSessionId}
                {isConnecting}
                {isLoadingSession}
                {onOpenConnectModal}
            />
        {/if}

        {#each transcript as item, itemIndex (item.id)}
            <div class={itemSpacing(itemIndex)}>
                {#if item.role === "user"}
                    <div
                        class="ml-auto w-full flex justify-end max-w-[85%] md:max-w-[75%]"
                    >
                        <UserMessage blocks={item.blocks} />
                    </div>
                {:else if item.role === "reasoning"}
                    <ReasoningTranscriptItem
                        {item}
                        {itemIndex}
                        transcriptLength={transcript.length}
                        {expandedReasoning}
                        {isSending}
                        {onToggleReasoning}
                        {reasoningSummary}
                    />
                {:else}
                    <AssistantTranscriptItem
                        {item}
                        {expandedBlocks}
                        {onToggleBlock}
                    />
                {/if}
            </div>
        {/each}
    </div>
</div>
