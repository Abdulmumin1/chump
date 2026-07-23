<script lang="ts">
    import { fade, slide } from "svelte/transition";
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
        onStartProject?: (projectId: string) => void;
        onStopProject?: (projectId: string) => void;
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
    let searchQuery = $state("");

    let activeProject = $derived(
        projects.find((project: DaemonProject) => project.id === activeProjectId) ??
            null,
    );

    let filteredProjects = $derived(
        projects.filter((project: DaemonProject) => {
            const query = searchQuery.trim().toLowerCase();
            if (!query) return true;
            return (
                project.name.toLowerCase().includes(query) ||
                project.workspacePath.toLowerCase().includes(query)
            );
        })
    );

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
        searchQuery = "";
    }

    async function chooseFolder(): Promise<void> {
        const selected = await onPickDirectory();
        if (!selected) return;
        workspacePath = selected;
        approved = false;
        registrationOpen = true;
        open = true;
    }

    function closeOnOutsidePointer(node: HTMLElement) {
        const handlePointerDown = (event: PointerEvent) => {
            if (
                open &&
                event.target instanceof Node &&
                !node.contains(event.target)
            ) {
                open = false;
                searchQuery = "";
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        return {
            destroy() {
                document.removeEventListener(
                    "pointerdown",
                    handlePointerDown,
                    true,
                );
            },
        };
    }
</script>

<div
    use:closeOnOutsidePointer
    class="relative"
>
    <!-- Trigger Button (Ultra-slim, No Shadows, No status labels/headers) -->
    <button
        type="button"
        class="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-bg-hover min-w-0 max-w-full"
        aria-haspopup="listbox"
        aria-expanded={open}
        onclick={() => { open = !open; if (!open) searchQuery = ""; }}
    >
        <span class="grid size-5 shrink-0 place-items-center rounded bg-bg-input text-[11px] font-bold text-text-main font-mono uppercase border border-border-default/40">
            {(activeProject?.name ?? "P").slice(0, 1)}
        </span>
        <span class="truncate text-xs font-semibold text-text-main max-w-[130px]">
            {activeProject?.name ?? "Select project"}
        </span>

        {#if loading}
            <BrailleSpinner class="shrink-0 font-mono text-[11px]" />
        {:else}
            <svg
                class="h-3 w-3 shrink-0 text-text-tertiary transition-transform duration-150"
                class:rotate-180={open}
                viewBox="0 0 20 20"
                fill="currentColor"
            >
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
        {/if}
    </button>

    <!-- Dropdown Content (Slim, Flat, Clean) -->
    {#if open}
        <div
            transition:fade={{ duration: 75 }}
            class="absolute left-1.5 right-1.5 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded border border-border-default bg-bg-surface p-0.5"
            role="listbox"
            aria-label="Projects"
        >
            <!-- Search Bar (Ultra-slim) -->
            <div class="border-b border-border-subtle p-1 mb-1">
                <input
                    type="text"
                    bind:value={searchQuery}
                    placeholder="Search projects..."
                    class="w-full rounded border border-border-subtle/55 bg-bg-input px-1.5 py-0.5 text-[10px] text-text-main placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
            </div>

            <div class="space-y-0.5">
                {#each filteredProjects as project (project.id)}
                    {@const isActive = project.id === activeProjectId}
                    <div
                        role="option"
                        aria-selected={isActive}
                        class="group flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 transition-colors hover:bg-bg-hover"
                        class:bg-bg-elevated={isActive}
                    >
                        <!-- Clickable Row to Switch -->
                        <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            onclick={() => {
                                open = false;
                                searchQuery = "";
                                onSelectProject(project.id);
                            }}
                        >
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1">
                                    <span class="truncate text-[11px] font-medium text-text-primary">
                                        {project.name}
                                    </span>
                                    {#if isActive}
                                        <svg class="h-3 w-3 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    {/if}
                                </div>
                                <span class="block truncate font-mono text-[8px] text-text-tertiary" title={project.workspacePath}>
                                    {project.workspacePath}
                                </span>
                            </div>
                        </button>
                    </div>
                {:else}
                    <div class="px-3 py-2 text-center text-[10px] text-text-tertiary">
                        {searchQuery ? "No matching projects." : "No registered projects."}
                    </div>
                {/each}
            </div>

            <!-- Footer / Add Project action -->
            <div class="mt-1 border-t border-border-subtle p-0.5">
                {#if registrationOpen}
                    <div
                        transition:slide={{ duration: 100 }}
                        class="space-y-2 rounded bg-bg-surface-alt/40 p-1.5 border border-border-subtle/50"
                    >
                        <form
                            class="space-y-2"
                            onsubmit={(event) => {
                                event.preventDefault();
                                void submitRegistration();
                            }}
                        >
                            <div class="block">
                                <span class="mb-0.5 block text-[8px] font-bold uppercase tracking-wider text-text-tertiary">
                                    Selected folder
                                </span>
                                <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-1.5 rounded border border-border-subtle bg-bg-input px-2 py-1 text-left font-mono text-[9px] text-text-main transition-colors hover:bg-bg-hover hover:border-border-default"
                                    onclick={() => void chooseFolder()}
                                >
                                    <span class="truncate">{workspacePath || "Choose folder..."}</span>
                                    {#if pickingDirectory}
                                        <BrailleSpinner class="shrink-0 font-mono text-[9px]" />
                                    {:else}
                                        <span class="shrink-0 font-sans text-[8px] font-bold text-accent">Browse</span>
                                    {/if}
                                </button>
                            </div>
                            <label class="block">
                                <span class="mb-0.5 block text-[8px] font-bold uppercase tracking-wider text-text-tertiary">
                                    Display name
                                </span>
                                <input
                                    bind:value={projectName}
                                    placeholder="Optional"
                                    autocomplete="off"
                                    class="w-full rounded border border-border-subtle bg-bg-input px-2 py-1 text-[9px] text-text-main placeholder:text-text-muted transition-all focus:border-accent focus:outline-none"
                                />
                            </label>
                            <label class="flex items-start gap-1.5 text-[8.5px] leading-snug text-text-tertiary select-none cursor-pointer">
                                <input
                                    type="checkbox"
                                    bind:checked={approved}
                                    class="mt-0.5 rounded border-border-subtle text-accent focus:ring-accent"
                                />
                                <span>
                                    Allow access to
                                    <span class="font-mono text-text-secondary font-medium">
                                        {workspacePath.trim() || "this path"}
                                    </span>
                                </span>
                            </label>
                            <div class="flex gap-1.5 pt-0.5">
                                <button
                                    type="button"
                                    class="flex-1 rounded border border-border-subtle px-2 py-1 text-[9px] font-semibold text-text-secondary transition-colors hover:bg-bg-hover"
                                    onclick={() => (registrationOpen = false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!workspacePath.trim() || !approved || registering}
                                    class="flex flex-1 items-center justify-center rounded bg-accent px-2 py-1 text-[9px] font-bold text-text-on-accent transition-colors disabled:opacity-50 hover:bg-accent/90"
                                >
                                    {#if registering}
                                        <BrailleSpinner class="font-mono text-[9px]" />
                                    {:else}
                                        Add project
                                    {/if}
                                </button>
                            </div>
                        </form>
                    </div>
                {:else}
                    <button
                        type="button"
                        class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                        onclick={() => (registrationOpen = true)}
                    >
                        <span class="text-[12px] leading-none text-accent font-bold">+</span>
                        <span>Add project</span>
                        <span class="ml-auto font-mono text-[8px] text-text-tertiary bg-bg-surface-alt px-1 py-0.5 rounded border border-border-subtle/40">⌘O / Ctrl+O</span>
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
