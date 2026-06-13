<script lang="ts">
    import type { FileSearchResult } from "$lib/chump/types";

    let {
        files,
        selectedIndex,
        loading,
        onSelect,
    } = $props<{
        files: FileSearchResult[];
        selectedIndex: number;
        loading: boolean;
        onSelect: (file: FileSearchResult) => void;
    }>();
</script>

<div
    class="absolute left-4 right-4 md:left-8 md:right-8 bottom-full mb-1 max-w-4xl mx-auto"
>
    <div
        class="bg-bg-code border border-border-default rounded-[8px] overflow-hidden max-h-[280px] overflow-y-auto"
        role="listbox"
        aria-label="File suggestions"
    >
        {#if loading && files.length === 0}
            <div class="px-4 py-2 text-[12px] text-text-tertiary">
                Searching files...
            </div>
        {:else if files.length === 0}
            <div class="px-4 py-2 text-[12px] text-text-tertiary">
                No matching files
            </div>
        {/if}
        {#each files as file, index (file.path)}
            <button
                role="option"
                class="flex w-full items-center gap-3 px-4 py-2 text-left {index ===
                selectedIndex
                    ? 'bg-bg-elevated'
                    : 'hover:bg-bg-elevated/50'}"
                onclick={() => onSelect(file)}
                data-suggestion-selected={index === selectedIndex}
                type="button"
                aria-selected={index === selectedIndex}
            >
                <span
                    class="truncate font-mono text-[13px] text-text-highlight"
                    >{file.path}</span
                >
            </button>
        {/each}
    </div>
</div>
