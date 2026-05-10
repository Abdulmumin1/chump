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
</script>

<aside
    class="{open
        ? 'translate-x-0'
        : '-translate-x-full'} fixed inset-y-0 left-0 w-[260px] flex flex-col bg-bg-surface-alt border-r border-border-subtle flex-shrink-0 z-30 transition-transform duration-200 ease-out"
>
    <div
        class="p-3 flex items-center justify-between border-b border-border-subtle"
    >
        <div class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-text-secondary">Home</span
            >
        </div>
    </div>

    <div class="p-2 border-b border-border-subtle">
        <input
            bind:value={sessionInput}
            onkeydown={(e) => e.key === "Enter" && onOpenSession()}
            placeholder="Open session ID..."
            class="w-full bg-bg-elevated border border-transparent focus:border-accent focus:outline-none rounded-sm px-2 py-1 text-[12px] text-text-secondary placeholder:text-text-tertiary"
        />
    </div>

    <div class="flex-1 overflow-y-auto py-2 space-y-0.5">
        {#if sessions.length === 0}
            <div class="px-4 py-2 text-[12px] text-text-tertiary">
                No sessions found.
            </div>
        {:else}
            {#each sessions as session (session.id)}
                <button
                    class="w-full text-left px-3 py-1.5 flex flex-col gap-0.5 group {session.id ===
                    activeSessionId
                        ? 'bg-bg-hover text-text-inverse'
                        : 'text-text-secondary hover:bg-bg-elevated'}"
                    onclick={() => onSelectSession(session.id)}
                >
                    <div class="flex justify-between items-center w-full">
                        <span
                            class="text-[13px] truncate pr-2 {session.id ===
                            activeSessionId
                                ? 'font-medium'
                                : ''}">{sessionTitle(session)}</span
                        >
                        {#if session.active || session.connections > 0}
                            <span
                                class="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0"
                            ></span>
                        {/if}
                    </div>
                    <div
                        class="flex justify-between items-center w-full text-[11px] {session.id ===
                        activeSessionId
                            ? 'text-text-muted'
                            : 'text-text-tertiary'}"
                    >
                        <span class="truncate pr-2 opacity-80"
                            >{session.id.split("-")[0]}...</span
                        >
                        <span
                            >{formatDate(
                                session.updated_at ?? session.created_at,
                            ).split(",")[0]}</span
                        >
                    </div>
                </button>
            {/each}
        {/if}
    </div>

    <!-- Sticky Footer: Connection status & controls -->
    <div class="border-t border-border-subtle bg-bg-surface-alt p-2 flex gap-1">
        <ThemeToggle />

        {#if isConnected}
            <button
                onclick={onOpenConnectModal}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-elevated transition-colors text-left"
                type="button"
            >
                <span class="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"
                ></span>
                <span class="text-[11px] font-mono text-text-tertiary truncate"
                    >{serverDisplay()}</span
                >
                <svg
                    class="w-3 h-3 text-text-tertiary ml-auto flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    ></path></svg
                >
            </button>
        {:else}
            <button
                onclick={onOpenConnectModal}
                class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-bg-elevated hover:bg-bg-elevated border border-border-default rounded-lg transition-colors text-[12px] text-text-secondary"
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
                <span>{isConnecting ? "Connecting..." : "Connect"}</span>
            </button>
        {/if}
    </div>
</aside>
