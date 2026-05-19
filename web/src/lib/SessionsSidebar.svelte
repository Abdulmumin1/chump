<script lang="ts">
    import ThemeToggle from "$lib/ThemeToggle.svelte";
    let {
        sessions,
        activeSessionId,
        sessionInput = $bindable(),
        health,
        serverUrl = "",
        isConnecting = false,
        canConnect = false,
        onCreateSession,
        onOpenSession,
        onSelectSession,
        onOpenConnectModal,
        onConnect,
        sessionTitle,
        formatDate,
        open = false,
        dragOffset = 0,
        isDragging = false,
    } = $props<{
        sessions: Array<any>;
        activeSessionId: string;
        sessionInput: string;
        health: unknown;
        serverUrl?: string;
        isConnecting?: boolean;
        canConnect?: boolean;
        onCreateSession: () => void;
        onOpenSession: () => void;
        onSelectSession: (id: string) => void;
        onOpenConnectModal: () => void;
        onConnect: () => void;
        sessionTitle: (session: any) => string;
        formatDate: (value: number | null) => string;
        open?: boolean;
        dragOffset?: number;
        isDragging?: boolean;
    }>();

    let isConnected = $derived(!!health);
    let serverDisplay = $derived(() => {
        try {
            const url = new URL(serverUrl);
            return url.host;
        } catch {
            return serverUrl || "—";
        }
    });

    let currentTranslate = $derived(isDragging ? Math.min(0, Math.max(-240, (open ? 0 : -240) + dragOffset)) : (open ? 0 : -240));
    let currentOpacity = $derived((currentTranslate + 240) / 240);
</script>

<aside
    class="fixed inset-y-0 left-0 w-[240px] flex flex-col bg-bg-surface-alt border-r border-border-subtle flex-shrink-0 z-30"
    class:transition-all={!isDragging}
    class:duration-200={!isDragging}
    class:ease-in-out={!isDragging}
    aria-hidden={!open && !isDragging}
    style:transform="translateX({currentTranslate}px)"
    style:opacity={currentOpacity}
    style:visibility={open || isDragging ? 'visible' : 'hidden'}
>
    <div
        class="p-2 flex items-center"
    >
        <button
            onclick={onCreateSession}
            class="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-bg-hover transition-colors text-text-secondary group border border-border-subtle rounded-sm"
        >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
            <span class="text-[13px] font-medium">New Chat</span>
        </button>
    </div>

    <div class="px-2 pb-2 border-b border-border-subtle">
        <div class="relative group">
            <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-text-tertiary group-focus-within:text-accent transition-colors">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
            <label for="session-filter-input" class="sr-only">Filter sessions</label>
            <input
                id="session-filter-input"
                bind:value={sessionInput}
                onkeydown={(e) => e.key === "Enter" && onOpenSession()}
                placeholder="Filter..."
                class="w-full bg-bg-elevated border border-transparent focus:border-accent/30 focus:bg-bg-surface focus:outline-none rounded-sm pl-7 pr-2 py-1 text-[12px] text-text-secondary placeholder:text-text-tertiary"
            />
        </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
        {#if sessions.length === 0}
            <div class="px-4 py-2 text-[12px] text-text-tertiary">
                No sessions found.
            </div>
        {:else}
            {#each sessions as session (session.id)}
                <button
                    class="w-full text-left px-3 py-2 flex flex-col gap-0 group transition-colors {session.id ===
                    activeSessionId
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary hover:bg-bg-elevated'}"
                    onclick={() => onSelectSession(session.id)}
                >
                    <div class="flex justify-between items-center w-full">
                        <span
                            class="text-[13px] truncate pr-2 {session.id ===
                            activeSessionId
                                ? 'font-medium'
                                : ''}"
                            >{sessionTitle(session)}</span
                        >
                        {#if session.active || session.connections > 0}
                            <span
                                class="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0"
                            ></span>
                        {/if}
                    </div>
                    <div
                        class="flex justify-between items-center w-full text-[10px] {session.id ===
                        activeSessionId
                            ? 'text-text-secondary/70'
                            : 'text-text-tertiary'}"
                    >
                        <div class="flex items-center gap-2 truncate pr-2 min-w-0">
                            <span class="font-mono truncate">{session.id}</span>
                            {#if (session.total_added ?? 0) > 0 || (session.total_removed ?? 0) > 0}
                                <span class="flex items-center gap-1 font-mono flex-shrink-0">
                                    {#if (session.total_added ?? 0) > 0}
                                        <span class="text-text-success">+{session.total_added}</span>
                                    {/if}
                                    {#if (session.total_removed ?? 0) > 0}
                                        <span class="text-text-error">-{session.total_removed}</span>
                                    {/if}
                                </span>
                            {/if}
                        </div>
                        <span class="whitespace-nowrap opacity-80"
                            >{formatDate(
                                session.updated_at ?? session.created_at,
                            ).split(",")[0]}</span
                        >
                    </div>
                </button>
            {/each}
        {/if}
    </div>

    <div class="p-1 mt-auto flex flex-col bg-bg-surface-alt border-t border-border-subtle">
        <div class="flex items-center gap-1">
            <ThemeToggle />
            {#if isConnected}
                <button
                    onclick={onOpenConnectModal}
                    class="flex-1 flex items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-bg-hover group"
                    type="button"
                >
                    <span class="block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success"></span>
                    <span class="text-[11px] font-medium text-text-tertiary group-hover:text-text-secondary truncate"
                        >{serverDisplay()}</span
                    >
                </button>
            {:else}
                <button
                    onclick={onOpenConnectModal}
                    class="flex-1 flex items-center justify-center gap-2 border border-border-subtle px-2 py-1 hover:bg-bg-hover transition-colors"
                >
                    <svg
                        class="w-3.5 h-3.5 text-text-tertiary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        ></path></svg
                    >
                    <span class="text-[11px] text-text-secondary">{isConnecting ? "..." : "Connect"}</span>
                </button>
            {/if}
        </div>
    </div>
</aside>
