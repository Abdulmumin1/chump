<script lang="ts">
    import { fly } from "svelte/transition";
    import type { Suggestion } from "$lib/chat/composer/commands";

    let {
        suggestions,
        selectedIndex,
        onSelect,
    } = $props<{
        suggestions: Suggestion[];
        selectedIndex: number;
        onSelect: (suggestion: Suggestion) => void;
    }>();
</script>

<div
    transition:fly={{ y: 8, duration: 200 }}
    class="absolute left-3 right-3 bottom-full mb-0 z-50"
>
    <div
        class="bg-bg-code border border-b-0 border-border-hover rounded-t-[8px] overflow-hidden max-h-[280px] overflow-y-auto"
        role="listbox"
        aria-label="Command suggestions"
    >
        {#each suggestions as suggestion, index (suggestion.command)}
            <button
                role="option"
                class="flex w-full items-center gap-3 px-4 py-2 text-left {index ===
                selectedIndex
                    ? 'bg-zinc-200/80 dark:bg-zinc-800/80 text-text-main'
                    : 'text-text-secondary hover:bg-zinc-200/40 dark:hover:bg-zinc-800/40'}"
                onclick={() => onSelect(suggestion)}
                data-suggestion-selected={index === selectedIndex}
                type="button"
                aria-selected={index === selectedIndex}
            >
                <span
                    class="min-w-[100px] font-mono text-[13px] font-medium text-text-main"
                    >{suggestion.label}</span
                >
                <span class="text-[12px] text-text-tertiary"
                    >{suggestion.description}</span
                >
            </button>
        {/each}
    </div>
</div>
