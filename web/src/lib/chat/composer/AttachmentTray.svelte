<script lang="ts">
    import type { ChatAttachment } from "$lib/chump/types";

    let {
        attachments,
        onRemove,
    } = $props<{
        attachments: ChatAttachment[];
        onRemove: (index: number) => void;
    }>();
</script>

<div class="flex flex-wrap gap-1.5 px-3 pt-2.5 md:px-4" aria-label="Attached files">
    {#each attachments as attachment, index (attachment.filename + index)}
        <div
            class="group flex min-w-0 max-w-56 items-center gap-1.5 rounded-full border border-border-default bg-bg-elevated py-1 pl-2.5 pr-1 text-xs text-text-secondary"
        >
            <svg
                class="h-3.5 w-3.5 flex-none text-text-tertiary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 00-5.656-5.656L5.758 10.758a6 6 0 108.484 8.484L20.5 13"
                ></path>
            </svg>
            <span class="truncate" title={attachment.filename}>
                {attachment.filename}
            </span>
            <button
                type="button"
                aria-label="Remove {attachment.filename}"
                class="flex h-5 w-5 flex-none items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-primary"
                onclick={() => onRemove(index)}
            >
                <svg
                    class="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    ></path>
                </svg>
            </button>
        </div>
    {/each}
</div>
