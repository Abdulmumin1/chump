<script lang="ts">
    import { fade, slide } from "svelte/transition";
    import Spinner from "$lib/Spinner.svelte";
    import type { LocalServiceProject } from "$lib/chump/local-service-api";

    let {
        projects,
        activeProjectId,
        loading = false,
        registering = false,
        pickingDirectory = false,
        onSelectProject,
        onRegisterProject,
        onPickDirectory,
    } = $props<{
        projects: LocalServiceProject[];
        activeProjectId: string;
        loading?: boolean;
        registering?: boolean;
        pickingDirectory?: boolean;
        onSelectProject: (projectId: string) => void;
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

    function formatPath(path: string): string {
        if (!path) return "";
        return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
    }

    let activeProject = $derived(
        projects.find(
            (project: LocalServiceProject) => project.id === activeProjectId,
        ) ?? null,
    );

    let filteredProjects = $derived(
        projects.filter((project: LocalServiceProject) => {
            const query = searchQuery.trim().toLowerCase();
            if (!query) return true;
            return (
                project.name.toLowerCase().includes(query) ||
                project.workspacePath.toLowerCase().includes(query)
            );
        }),
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

<div use:closeOnOutsidePointer class="relative w-full text-left">
    <!-- Trigger Button -->
    <button
        type="button"
        class="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-bg-hover w-full group cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
        onclick={() => {
            open = !open;
            if (!open) searchQuery = "";
        }}
    >
        <div class="flex items-center gap-2 min-w-0 flex-1">
            <span
                class="grid size-5 shrink-0 place-items-center rounded-md bg-accent/15 text-accent text-xs font-bold font-mono uppercase"
            >
                {(activeProject?.name ?? "P").slice(0, 1)}
            </span>
            <span
                class="truncate text-xs font-semibold text-text-main flex-1 min-w-0"
            >
                {activeProject?.name ?? "Select project"}
            </span>
        </div>

        {#if loading}
            <Spinner class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        {:else}
            <svg
                class="h-3.5 w-3.5 shrink-0 text-text-tertiary group-hover:text-text-main transition-transform duration-150"
                class:rotate-180={open}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                />
            </svg>
        {/if}
    </button>

    <!-- Dropdown Content (Sized to fit cleanly inside sidebar without overflow clipping) -->
    {#if open}
        <div
            transition:fade={{ duration: 100 }}
            class="absolute left-0 top-full z-50 mt-1.5 w-[232px] sm:w-[240px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-bg-surface p-2"
            role="listbox"
            aria-label="Projects"
        >
            <!-- Search Bar -->
            <div class="relative mb-2">
                <input
                    type="text"
                    bind:value={searchQuery}
                    placeholder="Search projects..."
                    class="w-full rounded-lg border border-border-default bg-bg-input pl-8 pr-7 py-1.5 text-xs text-text-main placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                />
                <svg
                    class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                </svg>
                {#if searchQuery}
                    <button
                        type="button"
                        onclick={() => (searchQuery = "")}
                        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-main text-xs"
                    >
                        ×
                    </button>
                {/if}
            </div>

            <!-- Project List -->
            <div
                class="max-h-60 overflow-y-auto space-y-1 p-0.5 scrollbar-thin"
            >
                {#each filteredProjects as project (project.id)}
                    {@const isActive = project.id === activeProjectId}
                    <div
                        role="option"
                        aria-selected={isActive}
                        class="group flex w-full items-center justify-between gap-2 rounded-lg p-2 transition-colors cursor-pointer {isActive
                            ? 'bg-accent/15 border border-accent/30 text-text-main font-medium'
                            : 'hover:bg-bg-hover/80 text-text-secondary border border-transparent hover:text-text-main'}"
                    >
                        <!-- Clickable Row to Switch -->
                        <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                            onclick={() => {
                                open = false;
                                searchQuery = "";
                                onSelectProject(project.id);
                            }}
                        >
                            <span
                                class="grid size-5 shrink-0 place-items-center rounded-md bg-bg-elevated text-[11px] font-bold text-text-main font-mono uppercase"
                            >
                                {project.name.slice(0, 1)}
                            </span>
                            <div class="min-w-0 flex-1">
                                <div
                                    class="flex items-center justify-between gap-1"
                                >
                                    <span
                                        class="truncate text-xs font-semibold text-text-main"
                                    >
                                        {project.name}
                                    </span>
                                    {#if isActive}
                                        <svg
                                            class="h-3.5 w-3.5 shrink-0 text-accent"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            stroke-width="2.5"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M5 13l4 4L19 7"
                                            />
                                        </svg>
                                    {/if}
                                </div>
                                <span
                                    class="block truncate font-mono text-[10px] text-text-tertiary mt-0.5"
                                    title={project.workspacePath}
                                >
                                    {formatPath(project.workspacePath)}
                                </span>
                            </div>
                        </button>
                    </div>
                {:else}
                    <div
                        class="px-3 py-4 text-center text-xs text-text-tertiary"
                    >
                        {searchQuery
                            ? "No matching projects found."
                            : "No registered projects."}
                    </div>
                {/each}
            </div>

            <!-- Footer / Add Project action -->
            <div class="mt-1.5 pt-1.5 border-t border-border-default/60">
                {#if registrationOpen}
                    <div
                        transition:slide={{ duration: 120 }}
                        class="space-y-2.5 rounded-lg bg-bg-surface-alt/80 p-2 border border-border-default"
                    >
                        <form
                            class="space-y-2"
                            onsubmit={(event) => {
                                event.preventDefault();
                                void submitRegistration();
                            }}
                        >
                            <div>
                                <span
                                    class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                                >
                                    Workspace Folder
                                </span>
                                <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-2 rounded-lg border border-border-default bg-bg-input px-2 py-1.5 text-left font-mono text-[11px] text-text-main transition-colors hover:bg-bg-hover cursor-pointer"
                                    onclick={() => void chooseFolder()}
                                >
                                    <span class="truncate min-w-0 flex-1"
                                        >{formatPath(workspacePath) ||
                                            "Choose folder..."}</span
                                    >
                                    {#if pickingDirectory}
                                        <Spinner
                                            class="w-3.5 h-3.5 text-text-tertiary shrink-0"
                                        />
                                    {:else}
                                        <span
                                            class="shrink-0 font-sans text-xs font-bold text-accent"
                                            >Browse</span
                                        >
                                    {/if}
                                </button>
                            </div>
                            <label class="block">
                                <span
                                    class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                                >
                                    Display Name
                                </span>
                                <input
                                    bind:value={projectName}
                                    placeholder="Optional"
                                    autocomplete="off"
                                    class="w-full rounded-lg border border-border-default bg-bg-input px-2 py-1 text-xs text-text-main placeholder:text-text-tertiary transition-all focus:border-accent focus:outline-none"
                                />
                            </label>
                            <label
                                class="flex items-start gap-1.5 text-[11px] leading-snug text-text-secondary select-none cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    bind:checked={approved}
                                    class="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
                                />
                                <span>
                                    Allow access to
                                    <span
                                        class="font-mono text-text-main font-medium"
                                    >
                                        {formatPath(workspacePath.trim()) ||
                                            "this folder"}
                                    </span>
                                </span>
                            </label>
                            <div class="flex gap-1.5 pt-1">
                                <button
                                    type="button"
                                    class="flex-1 rounded-lg border border-border-default px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover cursor-pointer"
                                    onclick={() => (registrationOpen = false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!workspacePath.trim() ||
                                        !approved ||
                                        registering}
                                    class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-text-on-accent transition-colors disabled:opacity-50 hover:bg-accent-hover cursor-pointer"
                                >
                                    {#if registering}
                                        <Spinner class="w-3.5 h-3.5" />
                                    {:else}
                                        Register Project
                                    {/if}
                                </button>
                            </div>
                        </form>
                    </div>
                {:else}
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-main group cursor-pointer"
                        onclick={() => (registrationOpen = true)}
                        >
                            <span
                                class="text-sm leading-none text-accent font-bold group-hover:scale-110 transition-transform"
                            >+</span
                        >
                        <span>Register Project</span>
                        <kbd
                            class="ml-auto font-mono text-[10px] text-text-tertiary opacity-70"
                            >⌘O</kbd
                        >
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
