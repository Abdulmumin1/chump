<script lang="ts">
    let {
        workspaceRoot = "",
        gitBranch = "",
        currentModel = "",
        reasoningInfo = null,
        onOpenModelPicker,
        shortenModel,
    } = $props<{
        workspaceRoot?: string;
        gitBranch?: string;
        currentModel?: string;
        reasoningInfo: { effort: string | null; budget: number | null } | null;
        onOpenModelPicker: () => void;
        shortenModel: (name: string) => string;
    }>();
</script>

<div
    class="max-w-4xl mx-auto flex items-center justify-between mt-1 md:mt-1.5 px-1"
>
    <div
        class="flex items-center gap-1.5 text-[10px] md:text-[11px] font-mono text-text-muted truncate max-w-[70%]"
    >
        <svg
            aria-label="Workspace root"
            class="w-3 h-3 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            ></path></svg
        >
        <span class="truncate">{workspaceRoot || "—"}</span>
        {#if gitBranch}
            <svg
                aria-label="Git branch"
                role="img"
                class="w-3.5 h-3.5 text-text-muted opacity-50 ml-1.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <line x1="6" x2="6" y1="3" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
            <span class="truncate ml-1">{gitBranch}</span>
        {/if}
    </div>
    <div class="flex items-center gap-2 min-w-0">
        {#if reasoningInfo?.effort}
            <span
                class="text-[10px] md:text-[11px] font-mono text-text-muted truncate"
            >
                {reasoningInfo.effort}{#if reasoningInfo.budget}
                    · {reasoningInfo.budget.toLocaleString()} tok{/if}
            </span>
        {/if}
        {#if currentModel}
            <button
                class="truncate text-left font-mono text-[10px] md:text-[11px] text-text-muted transition-colors hover:text-text-highlight"
                aria-label="Current model: {shortenModel(currentModel)}. Click to change."
                onclick={onOpenModelPicker}
                type="button"
            >
                {shortenModel(currentModel)}
            </button>
        {/if}
    </div>
</div>
