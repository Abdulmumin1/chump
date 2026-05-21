<script lang="ts">
    import type { SteeringQueueItem } from "$lib/chat/types";

    let {
        steeringQueue,
        onDelete,
        onEdit,
    } = $props<{
        steeringQueue: SteeringQueueItem[];
        onDelete: (index: number) => void;
        onEdit: (index: number) => void;
    }>();

    function steeringLabel(item: SteeringQueueItem): string {
        const text = (item.display_content || item.content).trim();
        if (text) return text;
        const count = item.attachments?.length ?? 0;
        return `${count} attachment${count === 1 ? "" : "s"}`;
    }
</script>

<div class="space-y-2 mb-2 w-full px-1">
    {#each steeringQueue as item, index (`${index}-${item.content}`)}
        <div
            class="group flex items-center gap-2 rounded-[7px] border border-border-default bg-bg-code/95 px-2.5 py-1.5"
        >
            <span
                class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-text-tertiary"
                >Queued</span
            >
            <span
                class="min-w-0 flex-1 truncate text-[13px] text-text-secondary"
                >{steeringLabel(item)}</span
            >
            <button
                type="button"
                aria-label="Delete queued steering"
                class="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-border-hover hover:text-error"
                onclick={() => onDelete(index)}
            >
                <svg
                    class="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.8"
                        d="M6 7h12m-9 0V5h6v2m-8 0 1 12h8l1-12"
                    ></path></svg
                >
            </button>
            <button
                type="button"
                aria-label="Edit queued steering"
                class="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-border-hover hover:text-text-highlight"
                onclick={() => onEdit(index)}
            >
                <svg
                    class="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.8"
                        d="m16.8 4.8 2.4 2.4M4 20h4.5L19.2 9.3a1.7 1.7 0 0 0 0-2.4l-2.1-2.1a1.7 1.7 0 0 0-2.4 0L4 15.5V20Z"
                    ></path></svg
                >
            </button>
        </div>
    {/each}
</div>
