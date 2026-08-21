<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import {
        terminalWebSocketConnection,
        type ChumpApiTarget,
        type TerminalTheme,
    } from "$lib/chump/api";
    import type {
        FitAddon as GhosttyFitAddon,
        IDisposable,
        Terminal as GhosttyTerminal,
    } from "ghostty-web";

    let {
        target,
        theme,
        active = false,
    } = $props<{
        target: ChumpApiTarget;
        theme: TerminalTheme;
        active?: boolean;
    }>();

    type TerminalStatus =
        | "idle"
        | "loading"
        | "connecting"
        | "connected"
        | "disconnected"
        | "exited"
        | "error";

    let host = $state<HTMLDivElement | null>(null);
    let status = $state<TerminalStatus>("idle");
    let errorMessage = $state("");
    let started = false;
    let destroyed = false;
    let terminal: GhosttyTerminal | null = null;
    let fitAddon: GhosttyFitAddon | null = null;
    let socket: WebSocket | null = null;
    let inputSubscription: IDisposable | null = null;
    let resizeSubscription: IDisposable | null = null;

    const encoder = new TextEncoder();

    $effect(() => {
        if (!active || !host) return;
        if (!started) {
            started = true;
            void startTerminal();
            return;
        }
        void tick().then(() => fitAddon?.fit());
    });

    async function startTerminal(): Promise<void> {
        if (!host || destroyed) return;
        status = "loading";
        errorMessage = "";
        try {
            const { FitAddon, Terminal, init } = await import("ghostty-web");
            await init();
            if (!host || destroyed) return;

            const style = getComputedStyle(host);
            terminal = new Terminal({
                cursorBlink: true,
                cursorStyle: "block",
                fontFamily:
                    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: window.matchMedia("(max-width: 767px)").matches
                    ? 13
                    : 12,
                scrollback: 10_000,
                smoothScrollDuration: 80,
                theme: {
                    background: cssColor(style, "--bg-surface", "#ffffff"),
                    foreground: cssColor(style, "--text-main", "#5a524d"),
                    cursor: cssColor(style, "--text-main", "#5a524d"),
                    selectionBackground: cssColor(
                        style,
                        "--accent-bg",
                        "#e4f222",
                    ),
                    black: "#1c1c1e",
                    red: "#c0685c",
                    green: "#5a9a5a",
                    yellow: "#a07860",
                    blue: "#5f78a8",
                    magenta: "#9b6a9b",
                    cyan: "#4f8f91",
                    white: "#d4d4d4",
                    brightBlack: "#858585",
                    brightRed: "#f48771",
                    brightGreen: "#7ee787",
                    brightYellow: "#d3de63",
                    brightBlue: "#7aa2d6",
                    brightMagenta: "#c58bc5",
                    brightCyan: "#75c4c7",
                    brightWhite: "#f4f4f5",
                },
            });
            fitAddon = new FitAddon();
            terminal.loadAddon(fitAddon);
            terminal.open(host);
            fitAddon.fit();
            fitAddon.observeResize();

            inputSubscription = terminal.onData((data) => {
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(encoder.encode(data));
                }
            });
            resizeSubscription = terminal.onResize(({ cols, rows }) => {
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "resize", cols, rows }));
                }
            });
            connectSocket();
        } catch (error) {
            status = "error";
            errorMessage = toErrorMessage(error);
        }
    }

    function connectSocket(): void {
        if (!terminal || destroyed) return;
        socket?.close();
        status = "connecting";
        errorMessage = "";
        const connection = terminalWebSocketConnection(target, {
            cols: terminal.cols,
            rows: terminal.rows,
            theme,
        });
        const nextSocket = new WebSocket(connection.url, connection.protocols);
        nextSocket.binaryType = "arraybuffer";
        socket = nextSocket;

        nextSocket.onopen = () => {
            if (socket !== nextSocket) return;
            status = "connected";
            nextSocket.send(
                JSON.stringify({
                    type: "resize",
                    cols: terminal?.cols ?? 80,
                    rows: terminal?.rows ?? 24,
                }),
            );
            terminal?.focus();
        };
        nextSocket.onmessage = (event) => {
            if (socket !== nextSocket) return;
            if (event.data instanceof ArrayBuffer) {
                terminal?.write(new Uint8Array(event.data));
                return;
            }
            if (event.data instanceof Blob) {
                void event.data
                    .arrayBuffer()
                    .then((data) => terminal?.write(new Uint8Array(data)));
                return;
            }
            if (typeof event.data === "string") {
                applyControlMessage(event.data);
            }
        };
        nextSocket.onerror = () => {
            if (socket !== nextSocket) return;
            status = "error";
            errorMessage = "Could not connect to the terminal";
        };
        nextSocket.onclose = () => {
            if (socket !== nextSocket || destroyed) return;
            socket = null;
            if (status !== "exited" && status !== "error") {
                status = "disconnected";
            }
        };
    }

    function applyControlMessage(value: string): void {
        let message: unknown;
        try {
            message = JSON.parse(value);
        } catch {
            return;
        }
        if (!isRecord(message) || typeof message.type !== "string") return;
        if (
            message.type === "status" &&
            (message.status === "connecting" || message.status === "connected")
        ) {
            status = message.status;
            return;
        }
        if (message.type === "exit") {
            status = "exited";
            return;
        }
        if (message.type === "error") {
            status = "error";
            errorMessage =
                typeof message.message === "string"
                    ? message.message
                    : "Terminal connection failed";
        }
    }

    function sendMobileKey(value: string): void {
        terminal?.input(value, true);
        terminal?.focus();
    }

    function reconnect(): void {
        terminal?.reset();
        connectSocket();
    }

    function cssColor(
        style: CSSStyleDeclaration,
        name: string,
        fallback: string,
    ): string {
        return style.getPropertyValue(name).trim() || fallback;
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function toErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    onDestroy(() => {
        destroyed = true;
        inputSubscription?.dispose();
        resizeSubscription?.dispose();
        socket?.close();
        terminal?.dispose();
        socket = null;
        terminal = null;
        fitAddon = null;
    });
</script>

<div class="relative flex min-h-0 min-w-0 w-full flex-1 flex-col bg-bg-surface">
    <div class="min-h-0 min-w-0 w-full flex-1 overflow-x-auto overflow-y-hidden">
        <div
            bind:this={host}
            class="terminal-host h-full min-h-0 min-w-[42rem] w-full overflow-hidden p-2 outline-none md:p-3"
            aria-label="Workspace terminal"
        ></div>
    </div>

    {#if status !== "connected" && status !== "idle"}
        <div
            class="pointer-events-none absolute right-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-border-subtle bg-bg-surface/90 px-2 py-1 text-[10px] text-text-tertiary shadow-sm backdrop-blur"
        >
            <span
                class="h-1.5 w-1.5 shrink-0 rounded-full {status ===
                'error'
                    ? 'bg-error'
                    : status === 'exited' || status === 'disconnected'
                      ? 'bg-text-tertiary'
                      : 'bg-warning'}"
            ></span>
            <span class="truncate">
                {errorMessage ||
                    (status === "loading"
                        ? "Loading Ghostty…"
                        : status === "connecting"
                          ? "Connecting…"
                          : status === "exited"
                            ? "Shell exited"
                            : status === "error"
                              ? "Terminal error"
                              : "Disconnected")}
            </span>
            {#if status === "disconnected" || status === "exited" || status === "error"}
                <button
                    type="button"
                    class="pointer-events-auto font-semibold text-text-secondary hover:text-text-main"
                    onclick={reconnect}
                >
                    Reconnect
                </button>
            {/if}
        </div>
    {/if}

    <div
        class="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-border-subtle bg-bg-surface-alt px-2 md:hidden"
        aria-label="Terminal shortcut keys"
    >
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x1b")}>Esc</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x03")}>Ctrl C</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\t")}>Tab</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x1b[D")} aria-label="Left arrow">←</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x1b[A")} aria-label="Up arrow">↑</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x1b[B")} aria-label="Down arrow">↓</button>
        <button class="terminal-key" type="button" onclick={() => sendMobileKey("\x1b[C")} aria-label="Right arrow">→</button>
    </div>
</div>

<style>
    .terminal-host {
        caret-color: transparent;
    }

    .terminal-host :global(canvas) {
        max-width: none;
    }

    .terminal-key {
        min-width: 2.25rem;
        height: 1.75rem;
        padding: 0 0.5rem;
        border: 1px solid var(--border-default);
        border-radius: 0.375rem;
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 0.65rem;
        white-space: nowrap;
    }

    .terminal-key:active {
        background: var(--bg-hover);
        color: var(--text-main);
    }
</style>
