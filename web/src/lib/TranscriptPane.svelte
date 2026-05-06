<script lang="ts">
    import ToolBlock from "$lib/ToolBlock.svelte";
    import MarkdownText from "$lib/MarkdownText.svelte";

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
    <div class="max-w-5xl mx-auto flex flex-col gap-6">
        {#if transcript.length === 0}
            <div class="text-center text-[#858585] text-[13px] mt-10">
                Connect to a server and select a session to begin.
            </div>
        {/if}

        {#each transcript as item (item.id)}
            {#if item.role === "user"}
                <div class="flex flex-col gap-2">
                    <div
                        class="px-2 text-[14px] text-[#cccccc] leading-relaxed whitespace-pre-wrap break-words"
                    >
                        {item.blocks
                            .map((b: { text: string }) => b.text)
                            .join("")}
                    </div>
                </div>
            {:else if item.role === "reasoning"}
                <div class="">
                    {#each item.blocks as block, index (`${item.id}-${index}`)}
                        {#if block.kind === "text" && block.text.trim()}
                            <div
                                class="p-2 transition-colors hover:bg-[#232325]/60"
                            >
                                <button
                                    class="flex w-full items-center justify-between gap-4 text-left focus:outline-none"
                                    onclick={() =>
                                        onToggleReasoning(
                                            `${item.id}-${index}`,
                                        )}
                                >
                                    <div
                                        class="flex items-center gap-3 text-[#a1a1aa] mb-2"
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
                                            class="text-[14px] font-medium tracking-tight text-[#b4b4c2]"
                                            >{reasoningSummary(
                                                block.text,
                                            )}</span
                                        >
                                    </div>
                                    <svg
                                        class="h-4 w-4 flex-shrink-0 text-[#8a8a96] transition-transform duration-200 {(expandedReasoning[
                                            `${item.id}-${index}`
                                        ] ?? true)
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
                                {#if expandedReasoning[`${item.id}-${index}`] ?? true}
                                    <div
                                        class="p-2 text-[15px] leading-[1.5] text-[#b8b8c4] whitespace-pre-wrap break-words"
                                    >
                                        <MarkdownText text={block.text} />
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
            {:else}
                <div
                    class="flex flex-col gap-2 {item.live ? 'opacity-90' : ''}"
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
                                class="p-3 bg-[#242426] border border-[#313133] rounded-md text-[12px] text-[#858585] inline-flex items-center gap-2 w-fit"
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
                class="flex items-center gap-2 px-2 text-[13px] text-[#858585] animate-pulse"
            >
                <span class="w-2 h-2 rounded-full bg-[#007fd4]"></span> Agent is thinking...
            </div>
        {/if}
    </div>
</div>
