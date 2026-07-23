<script lang="ts">
    let {
        sidebarOpen = false,
        onToggleSidebar,
    } = $props<{
        sidebarOpen?: boolean;
        onToggleSidebar: () => void;
    }>();
</script>

<div class="absolute top-0 left-0 z-20 p-3 pointer-events-none select-none md:p-4">
    {#if !sidebarOpen}
        <button
            class="icon-button pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border-default/50 bg-bg-surface/80 text-text-secondary backdrop-blur-xs transition-colors hover:bg-bg-hover hover:text-text-main"
            onclick={onToggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
        >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
        </button>
    {/if}
</div>
