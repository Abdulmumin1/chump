<script lang="ts">
    import DitherIdenticon from "$lib/DitherIdenticon.svelte";

    let {
        activeSessionId = "",
        onToggleSidebar,
        onCreateSession,
    } = $props<{
        activeSessionId?: string;
        onToggleSidebar: () => void;
        onCreateSession: () => void;
    }>();
</script>

<div
    class="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3 md:p-4 pointer-events-none select-none"
>
    <button
        class="icon-button pointer-events-auto h-8 w-8"
        onclick={onToggleSidebar}
        aria-label="Toggle sidebar"
    >
        <svg
            class="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
            ></path></svg
        >
    </button>

    {#if activeSessionId}
        <div
            class="pointer-events-auto hidden md:flex items-center gap-2 text-[13px] font-medium text-text-secondary bg-bg-elevated/50 backdrop-blur border border-border-subtle rounded-full px-3 py-1"
        >
            <DitherIdenticon
                seed={activeSessionId}
                class="w-4 h-4 rounded-full overflow-hidden flex-shrink-0"
            />
            <span class="truncate max-w-[200px]">{activeSessionId}</span>
        </div>
    {/if}

    <div class="flex items-center gap-2 pointer-events-none">
        <button
            aria-label="Create new session"
            class="icon-button pointer-events-auto h-8 w-8"
            onclick={onCreateSession}
        >
            <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M12 4v16m8-8H4"
                ></path></svg
            >
        </button>
    </div>
</div>
