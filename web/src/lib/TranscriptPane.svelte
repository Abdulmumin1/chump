<script lang="ts">
    import ToolBlock from "$lib/ToolBlock.svelte";
    import MarkdownText from "$lib/MarkdownText.svelte";
    import { marked } from "marked";

    let {
        transcript,
        transcriptElement = $bindable(),
        isSending,
        expandedBlocks,
        expandedReasoning,
        onToggleBlock,
        onToggleReasoning,
        reasoningSummary,
    } = $props<{
        transcript: Array<any>;
        transcriptElement: HTMLDivElement | null;
        isSending: boolean;
        expandedBlocks: Record<string, boolean>;
        expandedReasoning: Record<string, boolean>;
        onToggleBlock: (id: string) => void;
        onToggleReasoning: (id: string) => void;
        reasoningSummary: (text: string) => string;
    }>();
</script>

<div class="flex-1 overflow-y-auto p-4 md:p-8" bind:this={transcriptElement}>
    <div class="max-w-4xl mx-auto flex flex-col gap-6">
        {#if transcript.length === 0}
            <div class="text-center text-text-tertiary text-[13px] mt-10">
                Connect to a server and select a session to begin.
            </div>
        {/if}

        {#each transcript as item, itemIndex (item.id)}
            {#if item.role === "user"}
                <div class="self-end max-w-[85%] md:max-w-[75%]">
                    <div
                        class="bg-bg-elevated border border-border-default rounded-xl px-4 py-2.5 text-[14px] text-text-inverse leading-relaxed whitespace-pre-wrap break-words"
                    >
                        {item.blocks
                            .map((b: { text: string }) => b.text)
                            .join("")}
                    </div>
                </div>
            {:else if item.role === "reasoning"}
                <div class="min-w-0 w-full">
                    {#each item.blocks as block, index (`${item.id}-${index}`)}
                        {#if (block.kind === "text" || block.kind === "reasoning") && block.text.trim()}
                            <div
                                class="p-2 transition-colors hover:bg-bg-code-block/60 min-w-0"
                            >
                                <button
                                    class="flex w-full min-w-0 items-center justify-between gap-4 text-left focus:outline-none"
                                    onclick={() =>
                                        onToggleReasoning(
                                            `${item.id}-${index}`,
                                        )}
                                >
                                    <div
                                        class="flex min-w-0 items-center gap-3 text-text-muted mb-2"
                                    >
                                        <svg
                                            class="h-5 w-5 flex-shrink-0"
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
                                            class="text-[14px] font-medium tracking-tight text-text-muted break-words min-w-0"
                                            >{reasoningSummary(
                                                block.text,
                                            )}</span
                                        >
                                    </div>
                                    <svg
                                        class="h-4 w-4 flex-shrink-0 text-text-tertiary transition-transform duration-200 {(expandedReasoning[
                                            `${item.id}-${index}`
                                        ] ??
                                        (isSending &&
                                            itemIndex ===
                                                transcript.length - 1))
                                            ? 'rotate-180'
                                            : ''}"
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
                                {#if expandedReasoning[`${item.id}-${index}`] ?? (isSending && itemIndex === transcript.length - 1)}
                                    <div
                                        class="p-2 text-[12px] text-text-muted break-words overflow-hidden reasoning-marked"
                                    >
                                        {@html marked(block.text)}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
            {:else}
                <div
                    class="flex flex-col gap-2 min-w-0 {item.live
                        ? 'opacity-90'
                        : ''}"
                >
                    {#each item.blocks as block, index (`${item.id}-${index}`)}
                        {#if block.kind === "text" && block.text.trim()}
                            <div class="px-2">
                                <MarkdownText text={block.text} />
                            </div>
                        {:else if block.kind === "tool-call" || block.kind === "tool-result"}
                            <ToolBlock
                                {block}
                                expanded={expandedBlocks[`${item.id}-${index}`]}
                                onToggle={() =>
                                    onToggleBlock(`${item.id}-${index}`)}
                            />
                        {:else if block.kind === "image"}
                            <div
                                class="p-3 bg-bg-code border border-border-default rounded-md text-[12px] text-text-tertiary inline-flex items-center gap-2 w-fit"
                            >
                                <svg
                                    class="w-4 h-4"
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
                    {/each}
                </div>
            {/if}
        {/each}

        {#if isSending}
            <div
                class="flex items-center gap-2 px-2 text-[13px] text-text-tertiary animate-pulse"
            >
                <span class="w-2 h-2 rounded-full bg-accent"></span> Chumping...
            </div>
        {/if}
    </div>
</div>

<style>
    :global(.reasoning-marked pre) {
        white-space: pre-wrap;
        word-break: break-word;
        overflow-x: hidden;
    }
    :global(.reasoning-marked code) {
        white-space: pre-wrap;
        word-break: break-word;
    }
    :global(.reasoning-marked p) {
        word-break: break-word;
    }
</style>
