<script lang="ts">
    import DitherIdenticon from "$lib/DitherIdenticon.svelte";

    type UserMessageBlock = {
        kind: string;
        text: string;
        imageSrc?: string;
        mediaType?: string;
        label?: string;
        filename?: string;
    };

    let { blocks = [] } = $props<{ blocks: UserMessageBlock[] }>();

    let expanded = $state(false);
    let fullHeight = $state(0);

    const THRESHOLD = 240;
    let isLong = $derived(fullHeight > THRESHOLD);
    let textContent = $derived(
        blocks
            .map(
                (block: UserMessageBlock) =>
                    block.label || block.filename || block.text,
            )
            .join(" ")
            .trim(),
    );
    let messageSeed = $derived(textContent.substring(0, 40) || "empty");

    function imageCaption(block: UserMessageBlock): string {
        return (
            block.label ||
            block.filename ||
            block.text ||
            (block.mediaType ? `Image · ${block.mediaType}` : "Image attachment")
        );
    }
</script>

<div class="flex justify-end w-full">
    <div
        class="relative min-w-[60px] overflow-hidden rounded-l-md rounded-b-2xl bg-bg-elevated text-[13px] leading-relaxed text-text-inverse"
    >
        <div
            class="absolute right-0 top-0 bottom-0 w-1.5 border-l border-border-subtle/20"
        >
            <DitherIdenticon
                seed={messageSeed}
                size={8}
                class="h-full w-full object-cover opacity-60"
            />
        </div>

        <div
            class="relative z-10 pr-1.5 transition-all duration-300"
            style={!expanded && isLong
                ? `max-height: ${THRESHOLD}px; overflow: hidden;`
                : "max-height: 10000px; overflow: hidden;"}
        >
            <div
                bind:clientHeight={fullHeight}
                class="flex flex-col gap-2 px-3.5 py-1.5"
            >
                {#each blocks as block, index (`${block.kind}-${index}`)}
                    {#if block.kind === "image"}
                        {#if block.imageSrc}
                            <figure class="overflow-hidden rounded-xl border border-border-subtle/20 bg-black/10">
                                <img
                                    src={block.imageSrc}
                                    alt={imageCaption(block)}
                                    class="block max-h-80 w-full rounded-xl object-cover"
                                    loading="lazy"
                                />
                                <figcaption
                                    class="border-t border-border-subtle/15 bg-black/15 px-2.5 py-1.5 text-[11px] text-text-tertiary"
                                >
                                    {imageCaption(block)}
                                </figcaption>
                            </figure>
                        {:else}
                            <div
                                class="inline-flex w-fit items-center gap-2 rounded-xl border border-border-subtle/20 bg-black/10 px-2.5 py-2 text-[12px] text-text-tertiary"
                            >
                                <svg
                                    class="h-4 w-4"
                                    aria-hidden="true"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                    ></path>
                                </svg>
                                <span class="break-words">{imageCaption(block)}</span>
                            </div>
                        {/if}
                    {:else if block.text}
                        <div class="whitespace-pre-wrap break-words">{block.text}</div>
                    {/if}
                {/each}
            </div>
        </div>

        {#if !expanded && isLong}
            <div
                class="pointer-events-none absolute inset-x-0 bottom-0 z-15 h-20 bg-gradient-to-b from-transparent to-bg-elevated"
            ></div>
        {/if}

        {#if isLong}
            <div
                class="relative z-20 px-3.5 pb-2.5 pr-5 {expanded
                    ? 'pt-1'
                    : 'absolute bottom-0 left-0 flex w-full justify-end'}"
            >
                <button
                    onclick={() => (expanded = !expanded)}
                    class="flex items-center gap-1 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
                >
                    {expanded ? "Show less" : "Show more"}
                    <svg
                        class="h-3.5 w-3.5 transition-transform duration-300 {expanded
                            ? 'rotate-180'
                            : ''}"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                </button>
            </div>
        {/if}
    </div>
</div>
