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
        registering = false,
        pickingDirectory = false,
        onSelectProject,
        onStartProject,
        onStopProject,
        onRegisterProject,
        onPickDirectory,
    } = $props<{
        projects: DaemonProject[];
        activeProjectId: string;
        loading?: boolean;
        runtimes?: Record<string, DaemonRuntime>;
        runtimeActionProjectId?: string;
        registering?: boolean;
        pickingDirectory?: boolean;
        onSelectProject: (projectId: string) => void;
        onStartProject: (projectId: string) => void;
        onStopProject: (projectId: string) => void;
        onRegisterProject: (input: {
            workspacePath: string;
            name?: string;
        }) => void | Promise<void>;
        onPickDirectory: () => Promise<string | null>;
    }>();

    let open = $state(false);
    let registrationOpen = $state(false);
    let workspacePath = $state("");
    let projectName = $state("");
    let approved = $state(false);
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

    async function submitRegistration(): Promise<void> {
        const normalizedPath = workspacePath.trim();
        if (!normalizedPath || !approved || registering) return;
        try {
            await onRegisterProject({
                workspacePath: normalizedPath,
                name: projectName.trim() || undefined,
            });
        } catch {
            return;
        }
        workspacePath = "";
        projectName = "";
        approved = false;
        registrationOpen = false;
        open = false;
    }

    async function chooseFolder(): Promise<void> {
        const selected = await onPickDirectory();
        if (!selected) return;
        workspacePath = selected;
        approved = false;
        registrationOpen = true;
        open = true;
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

            <div class="border-t border-border-subtle p-2">
                {#if registrationOpen}
                    <form
                        class="space-y-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            void submitRegistration();
                        }}
                    >
                        <div class="block">
                            <span class="mb-1 block text-[9px] font-medium uppercase tracking-wide text-text-tertiary">
                                Selected folder
                            </span>
                            <button
                                type="button"
                                class="flex w-full items-center justify-between gap-2 rounded-sm border border-border-subtle bg-bg-input px-2 py-1.5 text-left font-mono text-[10px] text-text-main hover:bg-bg-hover"
                                onclick={() => void chooseFolder()}
                            >
                                <span class="truncate">{workspacePath || "Choose folder..."}</span>
                                {#if pickingDirectory}
                                    <BrailleSpinner class="shrink-0 font-mono text-[11px]" />
                                {:else}
                                    <span class="shrink-0 font-sans text-[9px] text-text-tertiary">Browse</span>
                                {/if}
                            </button>
                        </div>
                        <label class="block">
                            <span class="mb-1 block text-[9px] font-medium uppercase tracking-wide text-text-tertiary">
                                Display name
                            </span>
                            <input
                                bind:value={projectName}
                                placeholder="Optional"
                                autocomplete="off"
                                class="w-full rounded-sm border border-border-subtle bg-bg-input px-2 py-1.5 text-[10px] text-text-main placeholder:text-text-muted focus:outline-none"
                            />
                        </label>
                        <label class="flex items-start gap-2 text-[9px] leading-snug text-text-tertiary">
                            <input
                                type="checkbox"
                                bind:checked={approved}
                                class="mt-0.5"
                            />
                            <span>
                                Allow Chump to access
                                <span class="font-mono text-text-secondary">
                                    {workspacePath.trim() || "this path"}
                                </span>
                            </span>
                        </label>
                        <div class="flex gap-1.5">
                            <button
                                type="button"
                                class="flex-1 rounded-sm border border-border-subtle px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-hover"
                                onclick={() => (registrationOpen = false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!workspacePath.trim() || !approved || registering}
                                class="flex flex-1 items-center justify-center rounded-sm bg-accent px-2 py-1 text-[10px] font-semibold text-text-on-accent disabled:opacity-50"
                            >
                                {#if registering}
                                    <BrailleSpinner class="font-mono text-[11px]" />
                                {:else}
                                    Add project
                                {/if}
                            </button>
                        </div>
                    </form>
                {:else}
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[10px] font-medium text-text-secondary hover:bg-bg-hover"
                        onclick={() => (registrationOpen = true)}
                    >
                        <span class="text-[14px] leading-none">+</span>
                        Add project
                        <span class="ml-auto font-mono text-[9px] text-text-tertiary">⌘O / Ctrl+O</span>
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
