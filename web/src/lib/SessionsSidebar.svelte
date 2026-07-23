<script lang="ts">
    import { resolve } from "$app/paths";
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";
    import ThemeToggle from "$lib/ThemeToggle.svelte";
    import DitherIdenticon from "$lib/DitherIdenticon.svelte";
    import ProjectsSwitcher from "$lib/ProjectsSwitcher.svelte";
    import { authClient } from "$lib/auth-client";
    import type { DaemonProject, DaemonRuntime } from "$lib/chump/daemon-api";

    let {
        sessions,
        sessionPage = 1,
        sessionTotalPages = 1,
        activeSessionId,
        sessionInput = $bindable(),
        health,
        serverUrl = "",
        onCreateSession,
        onOpenSession,
        onSelectSession,
        onLoadMore,
        sessionTitle,
        open = false,
        workingSessionIds = [],
        projects = [],
        activeProjectId = "",
        isLoadingProject = false,
        onSelectProject,
        projectRuntimes = {},
        runtimeActionProjectId = "",
        onStartProject,
        onStopProject,
        isRegisteringProject = false,
        onRegisterProject,
        isPickingProjectDirectory = false,
        onPickProjectDirectory,
        onToggleSidebar,
        user,
    } = $props<{
        sessions: Array<any>;
        sessionPage?: number;
        sessionTotalPages?: number;
        activeSessionId: string;
        sessionInput: string;
        health: unknown;
        serverUrl?: string;
        onCreateSession: () => void;
        onOpenSession: () => void;
        onSelectSession: (id: string) => void;
        onLoadMore: () => Promise<void>;
        sessionTitle: (session: any) => string;
        open?: boolean;
        workingSessionIds?: readonly string[];
        projects?: DaemonProject[];
        activeProjectId?: string;
        isLoadingProject?: boolean;
        onSelectProject?: (projectId: string) => void;
        projectRuntimes?: Record<string, DaemonRuntime>;
        runtimeActionProjectId?: string;
        onStartProject?: (projectId: string) => void;
        onStopProject?: (projectId: string) => void;
        isRegisteringProject?: boolean;
        onRegisterProject?: (input: {
            workspacePath: string;
            name?: string;
        }) => void | Promise<void>;
        isPickingProjectDirectory?: boolean;
        onPickProjectDirectory?: () => Promise<string | null>;
        onToggleSidebar?: () => void;
        user?: { name: string; email: string; image?: string | null };
    }>();

    let showSearch = $state(false);
    let searchInputRef = $state<HTMLInputElement | null>(null);
    let menuOpen = $state(false);
    let isLoadingMore = $state(false);

    let isConnected = $derived(!!health);
    let serverDisplay = $derived.by(() => {
        try {
            const url = new URL(serverUrl);
            return url.host;
        } catch {
            return serverUrl || "—";
        }
    });

    function toggleSearch() {
        showSearch = !showSearch;
        if (showSearch) {
            setTimeout(() => searchInputRef?.focus(), 50);
        } else {
            sessionInput = "";
        }
    }

    async function handleSignOut() {
        menuOpen = false;
        const result = await authClient.signOut();
        if (!result.error) {
            window.location.assign(resolve("/"));
        }
    }

    async function loadMoreSessions() {
        if (isLoadingMore) return;
        isLoadingMore = true;
        try {
            await onLoadMore();
        } finally {
            isLoadingMore = false;
        }
    }
</script>

<aside
    class="flex flex-col h-full bg-bg-surface-alt w-full shrink-0 select-none overflow-hidden"
>
    <!-- Top Header Row: Borderless Project Selector & Action Icons -->
    <div
        class="px-3 pt-3 pb-2 flex items-center justify-between gap-1 shrink-0"
    >
        <div class="min-w-0 flex-1">
            {#if onSelectProject && onStartProject && onStopProject && onRegisterProject && onPickProjectDirectory}
                <ProjectsSwitcher
                    {projects}
                    {activeProjectId}
                    loading={isLoadingProject}
                    runtimes={projectRuntimes}
                    {runtimeActionProjectId}
                    {onSelectProject}
                    {onStartProject}
                    {onStopProject}
                    registering={isRegisteringProject}
                    {onRegisterProject}
                    pickingDirectory={isPickingProjectDirectory}
                    onPickDirectory={onPickProjectDirectory}
                />
            {/if}
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
            {#if onToggleSidebar}
                <button
                    type="button"
                    onclick={onToggleSidebar}
                    class="p-1.5 rounded-md text-text-tertiary hover:text-text-main hover:bg-bg-hover transition-colors"
                    aria-label="Collapse sidebar"
                    title="Collapse sidebar"
                >
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                        />
                    </svg>
                </button>
            {/if}
        </div>
    </div>

    <!-- Soft, Flat Action Button: + New session -->
    <div class="px-3 py-1 shrink-0">
        <button
            type="button"
            onclick={onCreateSession}
            class="flex items-center gap-2.5 w-full px-3 py-1.5 rounded-md hover:bg-bg-hover/10 text-text-main text-xs font-medium group"
        >
            <svg
                class="w-4 h-4 text-text-secondary group-hover:text-text-main shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                />
            </svg>
            <span class="font-medium flex-1 text-left">New session</span>
            <kbd class="text-[10px] font-mono text-text-tertiary opacity-60"
                >⌘N</kbd
            >
        </button>
    </div>

    <!-- Recent Sessions Section -->
    <div class="flex-1 overflow-y-auto px-3 py-3 flex flex-col min-h-0">
        <div class="px-1 pb-2 flex items-center justify-between shrink-0">
            <span class="text-xs font-semibold text-text-secondary">
                Recent
            </span>
            <button
                type="button"
                onclick={toggleSearch}
                class="p-1.5 rounded-md text-text-tertiary hover:text-text-main hover:bg-bg-hover transition-colors"
                title="Search sessions"
            >
                <svg
                    class="w-4 h-4"
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
            </button>
        </div>

        <!-- Filter Input (Visible when search icon is toggled or filtering) -->
        {#if showSearch}
            <div class=" pb-2 shrink-0">
                <div class="relative">
                    <input
                        bind:this={searchInputRef}
                        bind:value={sessionInput}
                        onkeydown={(e) => e.key === "Enter" && onOpenSession()}
                        placeholder="Filter sessions..."
                        class="w-full bg-bg-input border border-border-default focus:border-accent text-xs rounded-md pl-7 pr-7 py-1 text-text-main placeholder:text-text-tertiary outline-none transition-colors"
                    />
                    <svg
                        class="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
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
                    {#if sessionInput}
                        <button
                            type="button"
                            onclick={() => (sessionInput = "")}
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-main text-xs"
                        >
                            ×
                        </button>
                    {/if}
                </div>
            </div>
        {/if}

        <div class="space-y-0.5 flex-1 overflow-y-auto min-h-0 scrollbar-thin">
            {#if sessions.length === 0}
                <div class="px-1 py-4 text-xs text-text-tertiary">
                    No sessions
                </div>
            {:else}
                {#each sessions as session (session.id)}
                    {@const isActive = session.id === activeSessionId}
                    {@const isWorking = workingSessionIds.includes(session.id)}
                    <button
                        type="button"
                        class="w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between gap-2 transition-colors {isActive
                            ? 'bg-bg-hover text-text-inverse font-medium'
                            : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-main'}"
                        onclick={() => onSelectSession(session.id)}
                    >
                        <div class="flex items-center gap-2 min-w-0 flex-1">
                            {#if isWorking}
                                <div
                                    class="flex size-4 shrink-0 items-center justify-center rounded-full bg-text-highlight/10 text-text-highlight ring-1 ring-text-highlight/25 shadow-[0_0_7px_currentColor]"
                                    title="Working..."
                                >
                                    <BrailleSpinner
                                        intervalMs={55}
                                        class="font-mono text-[16px] font-black leading-none"
                                    />
                                </div>
                            {:else}
                                <DitherIdenticon
                                    seed={session.id}
                                    class="w-3.5 h-3.5 rounded-full shrink-0"
                                />
                            {/if}
                            <span class="text-xs truncate"
                                >{sessionTitle(session)}</span
                            >
                        </div>

                        <div
                            class="flex items-center gap-1.5 shrink-0 text-[10px] text-text-tertiary"
                        >
                            {#if (session.total_added ?? 0) > 0 || (session.total_removed ?? 0) > 0}
                                <span
                                    class="inline-flex items-center gap-1 font-mono text-[9.5px]"
                                >
                                    <span class="text-text-success"
                                        >+{session.total_added ?? 0}</span
                                    >
                                    <span class="text-text-error"
                                        >-{session.total_removed ?? 0}</span
                                    >
                                </span>
                            {/if}
                        </div>
                    </button>
                {/each}
                {#if sessionPage < sessionTotalPages}
                    <button
                        type="button"
                        class="mt-1 flex w-fit gap-1.5 rounded-md text-[11px] font-medium text-text-tertiary px-2 disabled:opacity-50"
                        disabled={isLoadingMore}
                        onclick={loadMoreSessions}
                    >
                        {#if isLoadingMore}
                            <BrailleSpinner
                                class="font-mono text-[13px] text-text-main"
                            />
                            Loading
                        {:else}
                            See more
                        {/if}
                    </button>
                {/if}
            {/if}
        </div>
    </div>

    <!-- Bottom Footer: Unified Single Menu Trigger -->
    <div
        class="relative p-2 border-t border-border-default/30 bg-bg-surface-alt shrink-0"
    >
        {#if menuOpen}
            <!-- Backdrop to close on click outside -->
            <button
                type="button"
                tabindex="-1"
                class="fixed inset-0 z-30 cursor-default bg-transparent"
                onclick={() => (menuOpen = false)}
                aria-label="Close menu"
            ></button>

            <!-- Popover Menu -->
            <div
                class="absolute bottom-full left-2 right-2 mb-2 z-40 bg-bg-surface border border-border-default rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 text-xs text-text-main transition-all duration-150"
            >
                <!-- Profile / Workspace Header -->
                <div
                    class="px-2 py-2 flex items-center gap-2.5 border-b border-border-default/40 mb-1"
                >
                    {#if user?.image}
                        <img
                            src={user.image}
                            alt=""
                            class="w-7 h-7 rounded-full object-cover shrink-0"
                        />
                    {:else if user}
                        <div
                            class="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center font-medium shrink-0 text-xs"
                        >
                            {(user.name || user.email || "A")[0].toUpperCase()}
                        </div>
                    {:else}
                        <div
                            class="w-7 h-7 rounded-full bg-bg-hover text-text-secondary flex items-center justify-center shrink-0"
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                />
                            </svg>
                        </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                        <div
                            class="font-medium text-text-main truncate text-xs"
                        >
                            {user?.name || "Local Workspace"}
                        </div>
                        <div class="text-[10.5px] text-text-tertiary truncate">
                            {user?.email ||
                                (isConnected
                                    ? `Host: ${serverDisplay}`
                                    : "Offline")}
                        </div>
                    </div>
                </div>

                <!-- Host Connection Action -->
                <a
                    href={`${resolve("/account")}?tab=connection${!activeProjectId && serverUrl.trim() ? `&server=${encodeURIComponent(serverUrl.trim())}` : ""}`}
                    onclick={() => (menuOpen = false)}
                    class="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors text-left group"
                >
                    <div class="flex items-center gap-2 min-w-0">
                        <span
                            class="size-2 rounded-full shrink-0 {isConnected
                                ? 'bg-success'
                                : 'bg-error'}"
                        ></span>
                        <span
                            class="text-text-secondary group-hover:text-text-main truncate text-xs"
                        >
                            {isConnected
                                ? `Host: ${serverDisplay}`
                                : "Connection settings"}
                        </span>
                    </div>
                    <span
                        class="text-[10px] text-text-tertiary font-mono group-hover:text-accent"
                    >
                        Settings
                    </span>
                </a>

                <div class="h-px bg-border-default/40 my-0.5"></div>

                <!-- Navigation Links -->
                <a
                    href={resolve("/account")}
                    onclick={() => (menuOpen = false)}
                    class="flex items-center gap-2 px-2 py-1.5 rounded-md text-text-secondary hover:text-text-main hover:bg-bg-hover transition-colors"
                >
                    <svg
                        class="w-4 h-4 text-text-tertiary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                    </svg>
                    <span>Account & Preferences</span>
                </a>

                <a
                    href={resolve("/organizations")}
                    onclick={() => (menuOpen = false)}
                    class="flex items-center gap-2 px-2 py-1.5 rounded-md text-text-secondary hover:text-text-main hover:bg-bg-hover transition-colors"
                >
                    <svg
                        class="w-4 h-4 text-text-tertiary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V11m0 0V7m0 4h4M7 7h10"
                        />
                    </svg>
                    <span>Organization</span>
                </a>

                <div class="h-px bg-border-default/40 my-0.5"></div>

                <!-- Theme Toggle Row -->
                <div
                    class="flex items-center justify-between px-2 py-1 text-text-secondary"
                >
                    <span class="text-xs">Theme</span>
                    <ThemeToggle />
                </div>

                {#if user}
                    <div class="h-px bg-border-default/40 my-0.5"></div>
                    <button
                        type="button"
                        onclick={handleSignOut}
                        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-text-error hover:bg-bg-hover transition-colors text-left"
                    >
                        <svg
                            class="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                        </svg>
                        <span>Sign Out</span>
                    </button>
                {/if}
            </div>
        {/if}

        <!-- Single Trigger Button -->
        <button
            type="button"
            onclick={() => (menuOpen = !menuOpen)}
            class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-text-secondary hover:text-text-main hover:bg-bg-hover transition-colors group"
        >
            <div class="flex items-center gap-2.5 min-w-0">
                {#if user?.image}
                    <img
                        src={user.image}
                        alt=""
                        class="w-6 h-6 rounded-full object-cover shrink-0"
                    />
                {:else if user}
                    <div
                        class="w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center font-medium shrink-0 text-[11px]"
                    >
                        {(user.name || user.email || "A")[0].toUpperCase()}
                    </div>
                {:else}
                    <div
                        class="w-6 h-6 rounded-full bg-bg-hover text-text-secondary flex items-center justify-center shrink-0"
                    >
                        <svg
                            class="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                        </svg>
                    </div>
                {/if}

                <div class="flex flex-col text-left min-w-0">
                    <span
                        class="text-xs font-medium text-text-main truncate leading-tight"
                    >
                        {user?.name || "Account & Settings"}
                    </span>
                    <span
                        class="text-[10px] text-text-tertiary truncate leading-tight"
                    >
                        {user?.email ||
                            (isConnected
                                ? `Host: ${serverDisplay}`
                                : "Offline")}
                    </span>
                </div>
            </div>

            <div
                class="flex items-center shrink-0 text-text-tertiary group-hover:text-text-main"
            >
                <svg
                    class="w-3.5 h-3.5 transition-transform duration-150 {menuOpen
                        ? 'rotate-180'
                        : ''}"
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
            </div>
        </button>
    </div>
</aside>
