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
</script>

<div class="p-2 transition-colors hover:bg-bg-code-block/60 min-w-0">
    <button
        class="flex w-full min-w-0 items-center justify-between gap-4 text-left focus:outline-none"
        onclick={() => onToggle(id, active)}
    >
        <div class="flex min-w-0 items-center gap-3 text-text-secondary">
            <span
                class="min-w-0 break-words text-[14px] font-medium tracking-tight {active
                    ? 'shimmer-text'
                    : 'text-text-secondary'}"
            >
                {active ? "Thinking..." : summary(text)}
            </span>
        </div>
    </button>
    {#if isExpanded}
        <div transition:slide={{ duration: 200 }} class="p-2">
            <MarkdownText {text} classes="text-[12px] text-text-secondary" />
        </div>
    {/if}
</div>
