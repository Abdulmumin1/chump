<script lang="ts">
    import Spinner from "$lib/Spinner.svelte";
    import type { LocalServiceProject } from "$lib/chump/local-service-api";

    let {
        projects,
        activeProjectId,
        loading = false,
        onOpenProjectPicker,
    } = $props<{
        projects: LocalServiceProject[];
        activeProjectId: string;
        loading?: boolean;
        onOpenProjectPicker: () => void;
    }>();

    let activeProject = $derived(
        projects.find(
            (project: LocalServiceProject) => project.id === activeProjectId,
        ) ?? null,
    );
</script>

<button
    type="button"
    class="group flex w-fit max-w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-border-subtle hover:bg-bg-hover"
    aria-label="Switch project"
    onclick={onOpenProjectPicker}
>
    <span class="flex min-w-0 flex-1 items-center gap-2">
        <svg
            class="h-4 w-4 shrink-0 text-text-secondary"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
        </svg>
        <span class="min-w-0 flex-1 truncate text-xs font-semibold text-text-main">
            {activeProject?.name ?? "Select project"}
        </span>
    </span>
    {#if loading}
        <Spinner class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
    {:else}
        <svg
            class="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-colors group-hover:text-text-main"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                d="M9 6l6 6-6 6"
            />
        </svg>
    {/if}
</button>
