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
            <svg
                class="h-5 w-5 flex-shrink-0 text-text-tertiary"
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
