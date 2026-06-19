<script lang="ts">
    import { fade, fly } from "svelte/transition";
    import { Command } from "bits-ui";
    import type { ModelChoice } from "$lib/models";
    import type { DaemonProject } from "$lib/chump/daemon-api";
    import { setDocumentTheme } from "$lib/theme";

    let {
        models = [],
        currentModel = "",
        currentThinking = "",
        projects = [],
        activeProjectId = "",
        onCommand,
        onToggleSidebar,
        onOpenConnectModal,
        onSelectProject,
    } = $props<{
        models: ModelChoice[];
        currentModel: string;
        currentThinking: string;
        projects?: DaemonProject[];
        activeProjectId?: string;
        onCommand: (command: string, args: string) => void | Promise<void>;
        onToggleSidebar: () => void;
        onOpenConnectModal: () => void;
        onSelectProject?: (projectId: string) => void;
    }>();

    let isOpen = $state(false);
    let searchQuery = $state("");
    type PaletteView = "main" | "models" | "reasoning" | "theme" | "projects";
    let currentView = $state<PaletteView>("main");

    type ActionItem = {
        id: string;
        label: string;
        description?: string;
        shortcut?: string;
        category: string;
        handler: () => void;
    };

    // Curated Main Actions as a derived array to dynamically react to projects list
    const mainActions = $derived.by((): ActionItem[] => {
        const actions: ActionItem[] = [
            {
                id: "new-session",
                label: "New Session",
                description: "Start a fresh chat with a clean context",
                shortcut: "⌘N",
                category: "Session Controls",
                handler: () => {
                    void onCommand("new", "");
                    isOpen = false;
                },
            },
            {
                id: "compact-context",
                label: "Compact Context",
                description: "Summarize history to optimize context token usage",
                shortcut: "⌥C",
                category: "Session Controls",
                handler: () => {
                    void onCommand("compact", "");
                    isOpen = false;
                },
            },
            {
                id: "clear-chat",
                label: "Clear Session Messages",
                description: "Wipe all messages in the current session",
                category: "Session Controls",
                handler: () => {
                    void onCommand("clear", "");
                    isOpen = false;
                },
            },
            {
                id: "change-model",
                label: "Change AI Model...",
                description: "Select which model to route this session through",
                shortcut: "⌘M",
                category: "Settings & Config",
                handler: () => {
                    currentView = "models";
                    searchQuery = "";
                },
            },
            {
                id: "set-reasoning",
                label: "Set Reasoning Level...",
                description: "Adjust the model's active thinking/reasoning scale",
                shortcut: "⌘T",
                category: "Settings & Config",
                handler: () => {
                    currentView = "reasoning";
                    searchQuery = "";
                },
            },
            ...(projects && projects.length > 0 ? [
                {
                    id: "switch-project",
                    label: "Switch Active Project...",
                    description: "Switch to another registered workspace",
                    shortcut: "⌘P",
                    category: "Settings & Config",
                    handler: () => {
                        currentView = "projects";
                        searchQuery = "";
                    },
                }
            ] : []),
            {
                id: "change-theme",
                label: "Change Theme Mode...",
                description: "Switch appearance between Light and Dark mode",
                shortcut: "⌘D",
                category: "Interface",
                handler: () => {
                    currentView = "theme";
                    searchQuery = "";
                },
            },
            {
                id: "toggle-sidebar",
                label: "Toggle Session Sidebar",
                description: "Show or hide the list of your past chat sessions",
                shortcut: "⌘B",
                category: "Interface",
                handler: () => {
                    onToggleSidebar();
                    isOpen = false;
                },
            },
            {
                id: "configure-server",
                label: "Configure Server...",
                description: "Update the agent backend server URL",
                category: "Settings & Config",
                handler: () => {
                    onOpenConnectModal();
                    isOpen = false;
                },
            },
        ];
        return actions;
    });

    // Reasoning Level Actions
    const reasoningLevels = [
        { id: "none", label: "None", desc: "Standard immediate responses" },
        { id: "low", label: "Low", desc: "Quick reasoning and analysis" },
        { id: "high", label: "High", desc: "Detailed step-by-step thinking" },
        { id: "xhigh", label: "Extra High", desc: "Maximum deep thinking level" },
    ];

    // Filtered lists based on searchQuery and currentView
    let filteredItems = $derived.by(() => {
        const query = searchQuery.toLowerCase().trim();
        if (currentView === "main") {
            if (!query) return mainActions;
            return mainActions.filter(
                (item) =>
                    item.label.toLowerCase().includes(query) ||
                    (item.description && item.description.toLowerCase().includes(query)),
            );
        } else if (currentView === "models") {
            const formattedModels = models.map((m: ModelChoice) => ({
                id: `${m.provider}/${m.model}`,
                label: `${m.provider}/${m.model}`,
                description: m.label,
                category: m.provider.toUpperCase(),
                handler: () => {
                    void onCommand("model", `${m.provider}/${m.model}`);
                    isOpen = false;
                },
            }));
            if (!query) return formattedModels;
            return formattedModels.filter(
                (m: any) =>
                    m.label.toLowerCase().includes(query) ||
                    m.description.toLowerCase().includes(query),
            );
        } else if (currentView === "theme") {
            const themes = [
                { id: "light", label: "Light Mode", description: "Standard high-contrast light layout" },
                { id: "dark", label: "Dark Mode", description: "Subtle low-contrast dark layout" }
            ];
            const formattedThemes = themes.map((t) => ({
                id: t.id,
                label: t.label,
                description: t.description,
                category: "Theme Appearance",
                handler: () => {
                    setDocumentTheme(t.id as "light" | "dark");
                    isOpen = false;
                }
            }));
            if (!query) return formattedThemes;
            return formattedThemes.filter(
                (t) =>
                    t.label.toLowerCase().includes(query) ||
                    t.description.toLowerCase().includes(query)
            );
        } else if (currentView === "projects") {
            const formattedProjects = projects.map((p: DaemonProject) => ({
                id: p.id,
                label: p.name,
                description: p.workspacePath,
                category: "Projects",
                handler: () => {
                    if (onSelectProject) onSelectProject(p.id);
                    isOpen = false;
                }
            }));
            if (!query) return formattedProjects;
            return formattedProjects.filter(
                (p: any) =>
                    p.label.toLowerCase().includes(query) ||
                    p.description.toLowerCase().includes(query)
            );
        } else {
            const formattedReasoning = reasoningLevels.map((rl) => ({
                id: rl.id,
                label: rl.label,
                description: rl.desc,
                category: "Thinking Level",
                handler: () => {
                    void onCommand("thinking", rl.id);
                    isOpen = false;
                },
            }));
            if (!query) return formattedReasoning;
            return formattedReasoning.filter(
                (r: any) =>
                    r.label.toLowerCase().includes(query) ||
                    r.description.toLowerCase().includes(query),
            );
        }
    });

    // Group items by category for visual organization
    type GroupedAction = {
        category: string;
        items: typeof filteredItems;
    };
    let groupedFilteredItems = $derived.by((): GroupedAction[] => {
        const groups: Record<string, typeof filteredItems> = {};
        for (const item of filteredItems) {
            if (!groups[item.category]) {
                groups[item.category] = [];
            }
            groups[item.category].push(item);
        }
        return Object.entries(groups).map(([category, items]) => ({
            category,
            items,
        }));
    });

    // Handle global Cmd+K / Ctrl+K keyboard shortcut
    function handleGlobalKeydown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            isOpen = !isOpen;
            if (isOpen) {
                currentView = "main";
                searchQuery = "";
            }
        }
    }

    // Inside-modal keyboard shortcuts (Escape and Backspace to go back)
    function handleModalKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            if (currentView !== "main") {
                currentView = "main";
                searchQuery = "";
            } else {
                isOpen = false;
            }
        } else if (e.key === "Backspace" && searchQuery === "" && currentView !== "main") {
            e.preventDefault();
            currentView = "main";
        }
    }

    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            }
        };
    }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if isOpen}
    <!-- Backdrop overlay -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        use:portal
        transition:fade={{ duration: 150 }}
        class="fixed inset-0 bg-bg-body/85 backdrop-blur-[4px] z-[99999] flex items-start justify-center pt-[12vh] p-4 cursor-default select-none"
        onclick={() => (isOpen = false)}
    >
        <!-- Palette dialog box -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            transition:fly={{ y: -16, duration: 250 }}
            class="w-full max-w-lg focus:outline-none"
            onclick={(e) => e.stopPropagation()}
        >
            <Command.Root
                class="bg-bg-code border border-border-default rounded-[12px] overflow-hidden flex flex-col w-full selection:bg-zinc-200/60 dark:selection:bg-zinc-800/60"
                onkeydown={handleModalKeydown}
            >
                <!-- Search header -->
                <div class="flex items-center gap-3 px-4 py-3.5 border-b border-border-default/80">
                    <svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    
                    {#if currentView !== "main"}
                        <button
                            onclick={() => {
                                currentView = "main";
                                searchQuery = "";
                            }}
                            class="px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-zinc-200 dark:bg-zinc-800 hover:opacity-85 text-text-secondary flex items-center gap-1 cursor-pointer transition-all border border-border-default"
                        >
                            <span>← Back</span>
                        </button>
                    {/if}

                    <Command.Input
                        bind:value={searchQuery}
                        placeholder={
                            currentView === "main" ? "Type a command or search..." :
                            currentView === "models" ? "Search models..." :
                            currentView === "theme" ? "Search themes..." :
                            currentView === "projects" ? "Search projects..." :
                            "Search reasoning levels..."
                        }
                        class="bg-transparent border-none text-[14px] text-text-main placeholder:text-text-muted focus:outline-none w-full outline-none selection:bg-zinc-200/60 dark:selection:bg-zinc-800/60"
                        autofocus
                    />
                </div>

                <!-- List viewport -->
                <Command.List class="max-h-[340px] overflow-y-auto p-1.5 flex flex-col outline-none">
                    <Command.Empty class="px-4 py-8 text-center text-text-tertiary text-[13px]">
                        No commands found for "{searchQuery}"
                    </Command.Empty>

                    {#if currentView === "main" || currentView === "models" || currentView === "theme" || currentView === "projects"}
                        {#each groupedFilteredItems as group (group.category)}
                            <Command.Group class="flex flex-col">
                                <div class="text-[10px] font-semibold text-text-tertiary/75 uppercase tracking-[0.1em] px-3 pt-2.5 pb-1 select-none">
                                    {group.category}
                                </div>
                                {#each group.items as item (item.id)}
                                    <Command.Item
                                        value={item.label}
                                        onSelect={() => item.handler()}
                                        class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left rounded-[8px] transition-all cursor-pointer text-text-secondary hover:bg-zinc-200/40 dark:hover:bg-zinc-800/40 data-[selected]:bg-zinc-200/80 dark:data-[selected]:bg-zinc-800/80 data-[selected]:text-text-main outline-none"
                                    >
                                        <div class="flex flex-col min-w-0 flex-1">
                                            <span class="text-[13px] font-medium leading-normal">{item.label}</span>
                                            {#if item.description}
                                                <span class="text-[11px] text-text-tertiary truncate leading-normal mt-0.5">{item.description}</span>
                                            {/if}
                                        </div>
                                        {#if item.shortcut}
                                            <span class="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-zinc-200/40 dark:bg-zinc-800/40 select-none flex-shrink-0">
                                                {item.shortcut}
                                            </span>
                                        {/if}
                                    </Command.Item>
                                {/each}
                            </Command.Group>
                        {/each}
                    {:else if currentView === "reasoning"}
                        <Command.Group class="flex flex-col">
                            <div class="text-[10px] font-semibold text-text-tertiary/75 uppercase tracking-[0.1em] px-3 pt-2.5 pb-1 select-none">
                                Thinking Level
                            </div>
                            {#each filteredItems as item (item.id)}
                                <Command.Item
                                    value={item.label}
                                    onSelect={() => item.handler()}
                                    class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left rounded-[8px] transition-all cursor-pointer text-text-secondary hover:bg-zinc-200/40 dark:hover:bg-zinc-800/40 data-[selected]:bg-zinc-200/80 dark:data-[selected]:bg-zinc-800/80 data-[selected]:text-text-main outline-none"
                                >
                                    <div class="flex flex-col min-w-0">
                                        <span class="text-[13px] font-medium leading-normal">{item.label}</span>
                                        {#if item.description}
                                            <span class="text-[11px] text-text-tertiary truncate leading-normal mt-0.5">{item.description}</span>
                                        {/if}
                                    </div>
                                </Command.Item>
                            {/each}
                        </Command.Group>
                    {/if}
                </Command.List>

                <!-- Footer indicator -->
                <div class="border-t border-border-default/60 px-4 py-2 flex items-center justify-between bg-bg-code-block/30 select-none text-text-tertiary text-[10px]">
                    <div class="flex items-center gap-3">
                        <span class="flex items-center gap-1"><kbd class="bg-zinc-200/60 dark:bg-zinc-800/60 px-1 py-0.5 rounded font-mono">↑↓</kbd> Navigate</span>
                        <span class="flex items-center gap-1"><kbd class="bg-zinc-200/60 dark:bg-zinc-800/60 px-1.5 py-0.5 rounded font-mono">Enter</kbd> Select</span>
                        <span class="flex items-center gap-1"><kbd class="bg-zinc-200/60 dark:bg-zinc-800/60 px-1.5 py-0.5 rounded font-mono">Esc</kbd> Close</span>
                    </div>
                    {#if currentView !== "main"}
                        <span class="flex items-center gap-1"><kbd class="bg-zinc-200/60 dark:bg-zinc-800/60 px-1.5 py-0.5 rounded font-mono">Backspace</kbd> Back</span>
                    {/if}
                </div>
            </Command.Root>
        </div>
    </div>
{/if}
