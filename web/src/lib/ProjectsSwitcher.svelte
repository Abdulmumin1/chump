<script lang="ts">
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";
    import type { DaemonProject } from "$lib/chump/daemon-api";

    let {
        projects,
        activeProjectId,
        loading = false,
        onSelectProject,
    } = $props<{
        projects: DaemonProject[];
        activeProjectId: string;
        loading?: boolean;
        onSelectProject: (projectId: string) => void;
    }>();

    let open = $state(false);
    let activeProject = $derived(
        projects.find((project: DaemonProject) => project.id === activeProjectId) ??
            null,
    );
</script>

<div class="relative border-b border-border-subtle p-2">
    <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-sm border border-border-subtle px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
        aria-haspopup="listbox"
        aria-expanded={open}
        onclick={() => (open = !open)}
    >
        <span class="min-w-0">
            <span class="block text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                Project
            </span>
            <span class="block truncate text-[13px] font-medium text-text-primary">
                {activeProject?.name ?? "Select project"}
            </span>
            {#if activeProject}
                <span class="block truncate font-mono text-[9px] text-text-tertiary">
                    {activeProject.workspacePath}
                </span>
            {/if}
        </span>
        {#if loading}
            <BrailleSpinner class="shrink-0 font-mono text-[13px]" />
        {:else}
            <svg class="h-3 w-3 shrink-0 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5.25 7.5 10 12.25 14.75 7.5H5.25Z" />
            </svg>
        {/if}
    </button>

    {#if open}
        <div
            class="absolute left-2 right-2 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-border-default bg-bg-surface shadow-xl"
            role="listbox"
            aria-label="Projects"
        >
            {#each projects as project (project.id)}
                <button
                    type="button"
                    role="option"
                    aria-selected={project.id === activeProjectId}
                    class="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
                    class:bg-bg-elevated={project.id === activeProjectId}
                    onclick={() => {
                        open = false;
                        onSelectProject(project.id);
                    }}
                >
                    <span
                        class="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full"
                        class:bg-success={project.status === "ready" || project.status === "busy"}
                        class:bg-text-tertiary={project.status === "offline"}
                        class:bg-error={project.status === "error"}
                        class:bg-accent={project.status === "starting"}
                    ></span>
                    <span class="min-w-0">
                        <span class="block truncate text-[12px] font-medium text-text-primary">
                            {project.name}
                        </span>
                        <span class="block truncate font-mono text-[9px] text-text-tertiary">
                            {project.workspacePath}
                        </span>
                    </span>
                </button>
            {:else}
                <div class="px-3 py-2 text-[11px] text-text-tertiary">
                    No registered projects.
                </div>
            {/each}
        </div>
    {/if}
</div>
