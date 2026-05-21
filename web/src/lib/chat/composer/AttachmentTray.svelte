<script lang="ts">
    import type { ChatAttachment } from "$lib/chump/types";
    import { attachmentThumbSrc } from "$lib/chat/composer/attachments";

    let {
        attachments,
        onRemove,
    } = $props<{
        attachments: ChatAttachment[];
        onRemove: (index: number) => void;
    }>();
</script>

<div class="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
    {#each attachments as attachment, index (attachment.filename + index)}
        <div
            class="relative group w-16 h-16 rounded-md overflow-hidden border border-border-default bg-bg-code flex-shrink-0"
        >
            <img
                src={attachmentThumbSrc(attachment)}
                alt="Preview of {attachment.filename}"
                class="w-full h-full object-cover"
            />
            <button
                type="button"
                aria-label="Remove attachment"
                class="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-bg-surface/80 text-text-tertiary hover:bg-error hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
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
            <span
                class="absolute bottom-0 left-0 right-0 text-[8px] text-text-inverse bg-black/50 truncate px-1 leading-relaxed"
            >
                {attachment.filename}
            </span>
        </div>
    {/each}
</div>
