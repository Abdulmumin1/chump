<script lang="ts">
    import MarkdownText from "$lib/MarkdownText.svelte";
    import { slide } from "svelte/transition";

    let {
        id,
        text,
        active = false,
        expanded,
        onToggle,
        summary,
    } = $props<{
        id: string;
        text: string;
        active?: boolean;
        expanded: boolean | undefined;
        onToggle: (id: string, defaultExpanded?: boolean) => void;
        summary: (text: string) => string;
    }>();

    let isExpanded = $derived(expanded ?? active);

    let scrollEl = $state<HTMLDivElement | null>(null);
    let userScrolledUp = $state(false);
    let hasTopFade = $state(false);
    let hasBottomFade = $state(false);

    function updateScrollState() {
        if (!scrollEl) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollEl;
        const maxScroll = scrollHeight - clientHeight;
        const scrollBottom = maxScroll - scrollTop;

        hasTopFade = scrollTop > 6;
        hasBottomFade = scrollBottom > 6;
        userScrolledUp = scrollBottom > 40;
    }

    $effect(() => {
        // Track incoming stream text and active state
        const _ = text;
        if (active && scrollEl && !userScrolledUp) {
            requestAnimationFrame(() => {
                if (!scrollEl || userScrolledUp) return;
                scrollEl.scrollTop = scrollEl.scrollHeight;
                updateScrollState();
            });
        }
    });

    $effect(() => {
        if (active) {
            userScrolledUp = false;
        }
    });

    let maskStyle = $derived.by(() => {
        if (!isExpanded) return "";
        if (!hasTopFade && !hasBottomFade) return "";
        const top = hasTopFade ? "transparent 0%, black 28px" : "black 0px";
        const bottom = hasBottomFade
            ? "black calc(100% - 24px), transparent 100%"
            : "black 100%";
        return `mask-image: linear-gradient(to bottom, ${top}, ${bottom}); -webkit-mask-image: linear-gradient(to bottom, ${top}, ${bottom});`;
    });
</script>

<div class="group/reasoning min-w-0 rounded-lg p-2 transition-colors hover:bg-bg-code-block/60">
    <button
        class="flex w-full min-w-0 items-center justify-between gap-4 text-left focus:outline-none cursor-pointer"
        onclick={() => onToggle(id, active)}
        type="button"
        aria-expanded={isExpanded}
    >
        <div class="flex min-w-0 items-center gap-2 text-text-secondary">
            {#if !active}
                <svg
                    class="size-3.5 shrink-0 text-text-tertiary transition-transform duration-200 {isExpanded
                        ? 'rotate-90'
                        : ''}"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5l7 7-7 7"
                    />
                </svg>
            {/if}
            <span
                class="min-w-0 break-words text-[13px] font-medium tracking-tight {active
                    ? 'shimmer-text'
                    : 'text-text-secondary'}"
            >
                {active ? "Thinking..." : summary(text)}
            </span>
        </div>
    </button>
    {#if isExpanded}
        <div transition:slide={{ duration: 200 }} class="relative mt-2 min-w-0">
            <div
                bind:this={scrollEl}
                onscroll={updateScrollState}
                class="no-scrollbar overflow-y-auto transition-all {active
                    ? 'max-h-[148px]'
                    : 'max-h-[360px]'}"
                style={maskStyle}
            >
                <MarkdownText
                    {text}
                    classes="text-[12px] text-text-secondary leading-relaxed"
                />
            </div>
        </div>
    {/if}
</div>

<style>
    .no-scrollbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
</style>
