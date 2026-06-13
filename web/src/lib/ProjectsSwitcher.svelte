<script lang="ts">
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";
    import type {
        DaemonProject,
        DaemonRuntime,
    } from "$lib/chump/daemon-api";

    let {
        projects,
        activeProjectId,
        loading = false,
        runtimes = {},
        runtimeActionProjectId = "",
        onSelectProject,
        onStartProject,
        onStopProject,
    } = $props<{
        projects: DaemonProject[];
        activeProjectId: string;
        loading?: boolean;
        runtimes?: Record<string, DaemonRuntime>;
        runtimeActionProjectId?: string;
        onSelectProject: (projectId: string) => void;
        onStartProject: (projectId: string) => void;
        onStopProject: (projectId: string) => void;
    }>();

    let open = $state(false);
    let activeProject = $derived(
        projects.find((project: DaemonProject) => project.id === activeProjectId) ??
            null,
    );
    let activeRuntime = $derived(
        activeProject ? runtimes[activeProject.id] : undefined,
    );

    function runtimeLabel(runtime: DaemonRuntime | undefined): string {
        if (!runtime) return "Unavailable";
        return runtime.status === "running" ? "Running" : "Stopped";
    }
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
                <span class="mt-0.5 block text-[9px] font-medium text-text-tertiary">
                    {runtimeLabel(activeRuntime)}
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
                {@const runtime = runtimes[project.id]}
                <div
                    role="option"
                    aria-selected={project.id === activeProjectId}
                    class="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
                    class:bg-bg-elevated={project.id === activeProjectId}
                >
                    <span
                        class="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full"
                        class:bg-success={runtime?.status === "running"}
                        class:bg-text-tertiary={runtime?.status === "stopped"}
                        class:bg-error={!runtime}
                    ></span>
                    <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        onclick={() => {
                            open = false;
                            onSelectProject(project.id);
                        }}
                    >
                        <span class="block truncate text-[12px] font-medium text-text-primary">{project.name}</span>
                        <span class="block truncate font-mono text-[9px] text-text-tertiary">{project.workspacePath}</span>
                        <span class="block text-[9px] text-text-tertiary">
                            {runtimeLabel(runtime)}
                        </span>
                    </button>
                    <button
                        type="button"
                        class="shrink-0 rounded-sm border border-border-subtle px-1.5 py-0.5 text-[9px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-50"
                        disabled={runtimeActionProjectId === project.id}
                        onclick={() =>
                            runtime?.status === "running"
                                ? onStopProject(project.id)
                                : onStartProject(project.id)}
                    >
                        {#if runtimeActionProjectId === project.id}
                            <BrailleSpinner class="font-mono text-[11px]" />
                        {:else if runtime?.status === "running"}
                            Stop
                        {:else}
                            Start
                        {/if}
                    </button>
                </div>
            {:else}
                <div class="px-3 py-2 text-[11px] text-text-tertiary">
                    No registered projects.
                </div>
            {/each}
        </div>
    {/if}
</div>
