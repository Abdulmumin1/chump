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
    } = $props<{
        transcript: TranscriptMessage[];
        transcriptElement: HTMLDivElement | null;
        isSending: boolean;
        isConnecting?: boolean;
        expandedBlocks: Record<string, boolean>;
        expandedReasoning: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
        onToggleReasoning: (id: string) => void;
        reasoningSummary: (text: string) => string;
        health?: ChumpHealth | null;
        activeSessionId?: string;
        onOpenConnectModal?: () => void;
    }>();
</script>

<div
    class="flex-1 overflow-y-auto p-4 md:p-8"
    bind:this={transcriptElement}
    style="mask-image: linear-gradient(to bottom, transparent 0, black 80px, black 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 80px, black 100%);"
>
    <div
        class="max-w-4xl mx-auto flex flex-col gap-6 {transcript.length > 0
            ? 'pt-10 md:pt-12'
            : ''}"
    >
        {#if transcript.length === 0}
            <TranscriptEmptyState
                {health}
                {activeSessionId}
                {isConnecting}
                {onOpenConnectModal}
            />
        {/if}

        {#each transcript as item, itemIndex (item.id)}
            {#if item.role === "user"}
                <div
                    class="self-end w-full flex justify-end max-w-[85%] md:max-w-[75%]"
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
        {/each}
    </div>
</div>
