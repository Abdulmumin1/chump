<script lang="ts">
    import { tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";

    let {
        open = false,
        serverUrl = $bindable(),
        canConnect,
        isConnecting,
        connectionError = "",
        qrScannerOpen = false,
        qrScannerError = "",
        qrVideoElement = $bindable(),
        onClose,
        onConnect,
        onStartQrScanner,
        onStopQrScanner,
        daemonUrl = $bindable(),
        daemonToken = $bindable(),
        onConnectDaemon,
    } = $props<{
        open: boolean;
        serverUrl: string;
        canConnect: boolean;
        isConnecting: boolean;
        connectionError?: string;
        qrScannerOpen?: boolean;
        qrScannerError?: string;
        qrVideoElement: HTMLVideoElement | null;
        onClose: () => void;
        onConnect: () => void | Promise<void>;
        onStartQrScanner: () => void | Promise<void>;
        onStopQrScanner: () => void;
        daemonUrl: string;
        daemonToken: string;
        onConnectDaemon: () => void | Promise<void>;
    }>();

    let connectUrlInput = $state<HTMLInputElement | null>(null);

    $effect(() => {
        if (!open) {
            return;
        }

        void tick().then(() => {
            connectUrlInput?.focus();
        });
    });
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay/60 backdrop-blur-[2px] p-4 w-full h-full border-none cursor-default"
        transition:fade={{ duration: 150 }}
        onclick={onClose}
    >
        <div
            class="flex w-full max-w-[300px] flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface shadow-2xl"
            transition:fly={{ y: 8, duration: 150 }}
            onclick={(event) => event.stopPropagation()}
        >
            <div class="p-1.5 space-y-1.5">
                <div class="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Local daemon
                </div>
                <div class="space-y-1.5 rounded-md border border-border-subtle bg-bg-elevated p-1.5">
                    <label for="daemon-url-input" class="sr-only">Daemon URL</label>
                    <input
                        id="daemon-url-input"
                        bind:value={daemonUrl}
                        placeholder="Daemon URL"
                        class="w-full rounded-sm border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
                        autocomplete="off"
                    />
                    <label for="daemon-token-input" class="sr-only">Daemon token</label>
                    <input
                        id="daemon-token-input"
                        bind:value={daemonToken}
                        placeholder="Daemon token"
                        type="password"
                        class="w-full rounded-sm border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
                        autocomplete="off"
                        onkeydown={(event) =>
                            event.key === "Enter" &&
                            daemonUrl.trim() &&
                            daemonToken.trim() &&
                            !isConnecting &&
                            (void onConnectDaemon())}
                    />
                    <button
                        type="button"
                        onclick={() => void onConnectDaemon()}
                        disabled={!daemonUrl.trim() || !daemonToken.trim() || isConnecting}
                        class="flex h-7 w-full items-center justify-center rounded-sm bg-accent px-2.5 text-[11px] font-bold text-text-on-accent disabled:opacity-60"
                    >
                        {#if isConnecting}
                            <BrailleSpinner class="font-mono text-[14px]" />
                        {:else}
                            Connect to projects
                        {/if}
                    </button>
                </div>

                <div class="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Direct server
                </div>
                <div
                    class="flex flex-col gap-1.5"
                    role="dialog"
                    aria-label="Connect to server"
                >
                    <div
                        class="flex bg-bg-input rounded-md border border-border-default focus-within:border-accent/40 transition-colors items-center pr-1"
                    >
                        <label for="server-url-input" class="sr-only"
                            >Server URL</label
                        >
                        <input
                            bind:this={connectUrlInput}
                            id="server-url-input"
                            bind:value={serverUrl}
                            placeholder="http://..."
                            onkeydown={(event) =>
                                event.key === "Enter" &&
                                canConnect &&
                                !isConnecting &&
                                (void onConnect())}
                            class="w-full bg-transparent border-none px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none"
                            autocomplete="off"
                        />
                        <button
                            onclick={() => {
                                void onConnect();
                            }}
                            disabled={!canConnect || isConnecting}
                            class="bg-accent text-text-on-accent h-6 px-2.5 rounded-sm text-[11px] font-bold transition-all active:scale-[0.95] disabled:opacity-70 flex items-center justify-center min-w-[60px]"
                        >
                            {#if isConnecting}
                                <span
                                    class="flex items-center gap-1.5"
                                    aria-live="polite"
                                >
                                    <BrailleSpinner class="font-mono text-[14px]" />
                                </span>
                            {:else}
                                Connect
                            {/if}
                        </button>
                    </div>

                    <button
                        onclick={() => void onStartQrScanner()}
                        class="flex items-center justify-center gap-2 w-full py-1.5 rounded-md bg-bg-elevated border border-border-subtle hover:bg-bg-hover transition-colors text-text-secondary group active:scale-[0.98]"
                    >
                        <svg
                            class="w-4 h-4 text-text-tertiary group-hover:text-accent transition-colors"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"
                            />
                            <rect x="7" y="7" width="3" height="3" rx="0.5" />
                            <rect x="14" y="7" width="3" height="3" rx="0.5" />
                            <rect x="7" y="14" width="3" height="3" rx="0.5" />
                            <rect x="14" y="14" width="1" height="1" />
                            <rect x="16" y="16" width="1" height="1" />
                            <rect x="14" y="16" width="1" height="1" />
                            <rect x="16" y="14" width="1" height="1" />
                        </svg>
                        <span class="text-[12px] font-medium">Scan QR Code</span>
                    </button>
                </div>

                {#if qrScannerOpen}
                    <div
                        class="relative overflow-hidden rounded-md border border-border-default bg-black aspect-square shadow-inner"
                    >
                        <video
                            bind:this={qrVideoElement}
                            class="w-full h-full object-cover"
                            playsinline
                            muted
                        ></video>
                        <button
                            aria-label="Close QR scanner"
                            onclick={onStopQrScanner}
                            class="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full backdrop-blur-md"
                        >
                            <svg
                                class="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                aria-label="Close scanner"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    </div>
                {/if}

                {#if connectionError || qrScannerError}
                    <div
                        class="text-[10px] text-error px-2 py-1.5 flex items-start gap-1.5 bg-error/5 rounded-md border border-error/10"
                    >
                        <svg
                            class="w-3.5 h-3.5 mt-0.5 shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                        {connectionError || qrScannerError}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
