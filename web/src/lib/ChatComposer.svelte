<script lang="ts">
    import { tick } from "svelte";
    import CommandMenu from "./CommandMenu.svelte";

    import type { ModelChoice } from "$lib/models";

    let {
        composerText = $bindable(),
        activeSessionId,
        canSend,
        isSending,
        skills = [],
        models = [],
        currentModel = "",
        workspaceRoot = "",
        reasoningInfo = null,
        steeringQueue = ["nice and seeet"],
        onSend,
        onDeleteSteering,
        onEditSteering,
        onCommand,
    } = $props<{
        composerText: string;
        activeSessionId: string;
        canSend: boolean;
        isSending: boolean;
        skills: Array<{ name: string; description: string }>;
        models: ModelChoice[];
        currentModel: string;
        workspaceRoot: string;
        reasoningInfo: { effort: string | null; budget: number | null } | null;
        steeringQueue: Array<{
            content: string;
            attachments?: Array<Record<string, unknown>>;
        }>;
        onSend: () => void;
        onDeleteSteering: (index: number) => void;
        onEditSteering: (index: number) => void;
        onCommand: (command: string, args: string) => void | Promise<void>;
    }>();

    let textareaElement = $state<HTMLTextAreaElement | null>(null);
    let selectedIndex = $state(0);
    let menuOpen = $state(false);

    type Suggestion = {
        label: string;
        command: string;
        description: string;
        kind: "root" | "model" | "skill" | "command";
    };

    const ROOT_COMMANDS: Suggestion[] = [
        {
            label: "/model",
            command: "/model ",
            description: "choose provider and model",
            kind: "root",
        },
        {
            label: "/thinking",
            command: "/thinking ",
            description: "choose reasoning level",
            kind: "root",
        },
        {
            label: "/skill",
            command: "/skill:",
            description: "load a skill manually",
            kind: "root",
        },
        {
            label: "/clear",
            command: "/clear",
            description: "clear messages for current session",
            kind: "command",
        },
        {
            label: "/new",
            command: "/new",
            description: "start a fresh session",
            kind: "command",
        },
    ];

    const THINKING_PRESETS: Suggestion[] = [
        {
            label: "none",
            command: "/thinking none",
            description: "disable thinking",
            kind: "command",
        },
        {
            label: "low",
            command: "/thinking low",
            description: "small thinking budget",
            kind: "command",
        },
        {
            label: "high",
            command: "/thinking high",
            description: "larger thinking budget",
            kind: "command",
        },
        {
            label: "xhigh",
            command: "/thinking xhigh",
            description: "maximum thinking budget",
            kind: "command",
        },
    ];

    let suggestions = $derived.by(() => {
        const text = composerText;
        if (!text.startsWith("/")) return [];

        const trimmed = text.trim();

        // Skill completion: /skill:name or /skill name
        if (trimmed.startsWith("/skill:") || /^\/skill\s/.test(trimmed)) {
            const query = trimmed.startsWith("/skill:")
                ? trimmed.slice("/skill:".length).trim().toLowerCase()
                : trimmed.slice("/skill".length).trim().toLowerCase();
            return skills
                .filter(
                    (s: { name: string; description: string }) =>
                        !query || s.name.toLowerCase().includes(query),
                )
                .map((s: { name: string; description: string }) => ({
                    label: s.name,
                    command: `/skill:${s.name}`,
                    description: s.description,
                    kind: "skill" as const,
                }));
        }

        // Model completion: /model query
        if (/^\/model(?:\s|$)/.test(trimmed)) {
            const query = trimmed.slice("/model".length).trim().toLowerCase();
            return models
                .filter((m: ModelChoice) => !query || m.label.toLowerCase().includes(query) || m.description.toLowerCase().includes(query))
                .map((m: ModelChoice) => ({
                    label: m.label,
                    command: `/model ${m.label}`,
                    description: m.description,
                    kind: "model" as const,
                }));
        }

        if (/^\/thinking(?:\s|$)/.test(trimmed)) {
            const query = trimmed
                .slice("/thinking".length)
                .trim()
                .toLowerCase();
            return THINKING_PRESETS.filter(
                (item) => !query || item.label.includes(query),
            );
        }

        // Root command completion
        const hits = ROOT_COMMANDS.filter((c) => c.label.startsWith(trimmed));
        return hits.length > 0 ? hits : trimmed === "/" ? ROOT_COMMANDS : [];
    });

    let visible = $derived(suggestions.length > 0 && menuOpen);

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) {
            // Check if this is starting a slash command
            if (event.key === "/" && !composerText) {
                menuOpen = true;
                selectedIndex = 0;
            }
            // Let the parent handle normal send keys
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSend();
                return;
            }
            return;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                selectedIndex = (selectedIndex + 1) % suggestions.length;
                scrollSelectedIntoView();
                break;
            case "ArrowUp":
                event.preventDefault();
                selectedIndex =
                    (selectedIndex - 1 + suggestions.length) %
                    suggestions.length;
                scrollSelectedIntoView();
                break;
            case "Enter":
                event.preventDefault();
                acceptSuggestion(suggestions[selectedIndex]);
                break;
            case "Escape":
                event.preventDefault();
                menuOpen = false;
                break;
            case "Tab":
                event.preventDefault();
                if (suggestions.length === 1) {
                    acceptSuggestion(suggestions[0]);
                } else {
                    selectedIndex = (selectedIndex + 1) % suggestions.length;
                    scrollSelectedIntoView();
                }
                break;
        }
    }

    function acceptSuggestion(suggestion: Suggestion | undefined) {
        if (!suggestion) return;

        if (suggestion.kind === "root" && suggestion.command.endsWith(" ")) {
            // Keep menu open for next level (model/skill selection)
            composerText = suggestion.command;
            selectedIndex = 0;
            void tick().then(() => {
                textareaElement?.focus();
            });
            return;
        }

        // Execute the command
        menuOpen = false;
        composerText = "";
        void tick().then(() => {
            textareaElement?.focus();
        });

        // Parse the command
        const trimmed = suggestion.command.trim();
        if (trimmed === "/clear") {
            void onCommand("clear", "");
            return;
        }
        if (trimmed === "/new") {
            void onCommand("new", "");
            return;
        }
        if (trimmed.startsWith("/model ")) {
            const modelSpec = trimmed.slice("/model ".length).trim();
            void onCommand("model", modelSpec);
            return;
        }
        if (trimmed.startsWith("/thinking ")) {
            const mode = trimmed.slice("/thinking ".length).trim();
            void onCommand("thinking", mode);
            return;
        }
        if (trimmed.startsWith("/skill:")) {
            const skillName = trimmed.slice("/skill:".length).trim();
            void onCommand("skill", skillName);
            return;
        }
    }

    function scrollSelectedIntoView() {
        void tick().then(() => {
            const el = document.querySelector(
                '[data-suggestion-selected="true"]',
            );
            el?.scrollIntoView({ block: "nearest" });
        });
    }

    function handleInput() {
        if (!composerText.startsWith("/")) {
            menuOpen = false;
            return;
        }
        menuOpen = true;
        selectedIndex = 0;
    }

    function shortenModel(name: string): string {
        return name.replace(/^workers_ai\/@cf\//, "");
    }

    function steeringLabel(item: {
        content: string;
        attachments?: Array<Record<string, unknown>>;
    }): string {
        const text = item.content.trim();
        if (text) return text;
        const count = item.attachments?.length ?? 0;
        return `${count} attachment${count === 1 ? "" : "s"}`;
    }

    let isCommand = $derived(composerText.trim().startsWith("/"));
    let currentThinking = $derived(reasoningInfo?.effort ?? "");
</script>

<div class="w-full px-2 md:px-8 pb-4 md:pb-6 pt-2 bg-bg-surface relative">
    {#if steeringQueue.length > 0}
        <div class="max-w-3xl mx-auto space-y-2 first:rounded-t-lg">
            {#each steeringQueue as item, index (`${index}-${item.content}`)}
                <div
                    class="group flex items-center gap-2 border border-border-default bg-bg-code/95 px-3 py-2"
                >
                    <span
                        class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-text-tertiary"
                        >Queued</span
                    >
                    <span
                        class="min-w-0 flex-1 truncate text-[13px] text-text-secondary"
                        >{steeringLabel(item)}</span
                    >
                    <button
                        type="button"
                        aria-label="Delete queued steering"
                        class="flex h-7 w-7 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-border-hover hover:text-error"
                        onclick={() => onDeleteSteering(index)}
                    >
                        <svg
                            class="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.8"
                                d="M6 7h12m-9 0V5h6v2m-8 0 1 12h8l1-12"
                            ></path></svg
                        >
                    </button>
                    <button
                        type="button"
                        aria-label="Edit queued steering"
                        class="flex h-7 w-7 items-center justify-center rounded-[6px] text-text-tertiary transition-colors hover:bg-border-hover hover:text-accent"
                        onclick={() => onEditSteering(index)}
                    >
                        <svg
                            class="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.8"
                                d="m16.8 4.8 2.4 2.4M4 20h4.5L19.2 9.3a1.7 1.7 0 0 0 0-2.4l-2.1-2.1a1.7 1.7 0 0 0-2.4 0L4 15.5V20Z"
                            ></path></svg
                        >
                    </button>
                </div>
            {/each}
        </div>
    {/if}
    <div
        class="max-w-4xl mx-auto bg-bg-code border border-border-default rounded-[8px] flex flex-col focus-within:border-border-hover relative z-10"
    >
        <textarea
            bind:this={textareaElement}
            bind:value={composerText}
            rows="2"
            placeholder="Message the agent..."
            onkeydown={handleKeydown}
            oninput={handleInput}
            class="w-full bg-transparent border-none rounded-t-[8px] px-3 md:px-4 py-2.5 md:py-3 text-[14px] text-text-secondary focus:outline-none resize-none min-h-[52px] md:min-h-[60px] max-h-[200px] md:max-h-[300px] placeholder:text-text-muted"
        ></textarea>

        <div
            class="flex justify-between items-center px-2 md:px-3 py-1.5 md:py-2 border-t border-border-default rounded-b-[8px]"
        >
            <div class="flex items-center gap-2">
                {#if !composerText.trim()}
                    <CommandMenu
                        {models}
                        {currentModel}
                        {currentThinking}
                        {onCommand}
                    />
                {/if}
            </div>
            <div class="flex items-center gap-2">
                <span
                    class="text-[11px] md:text-[12px] font-medium text-text-muted mr-1 md:mr-2 tracking-wide hidden sm:inline"
                    >⌘ Enter</span
                >
                <button
                    aria-label={isSending ? "Queue message" : "Send message"}
                    class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-bg-code text-text-tertiary hover:bg-bg-code hover:text-text-secondary rounded-[6px] disabled:opacity-50"
                    onclick={onSend}
                    disabled={!canSend || isCommand}
                >
                    <svg
                        class="w-3.5 h-3.5 md:w-4 md:h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M14 5l7 7m0 0l-7 7m7-7H3"
                        ></path></svg
                    >
                </button>
            </div>
        </div>
    </div>

    <div
        class="max-w-4xl mx-auto flex items-center justify-between mt-1 md:mt-1.5 px-1"
    >
        <div
            class="flex items-center gap-1.5 text-[10px] md:text-[11px] font-mono text-text-muted truncate max-w-[70%]"
        >
            <svg
                class="w-3 h-3 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                ></path></svg
            >
            <span class="truncate">{workspaceRoot || "—"}</span>
        </div>
        <div class="flex items-center gap-2 min-w-0">
            {#if reasoningInfo?.effort}
                <span
                    class="text-[10px] md:text-[11px] font-mono text-text-muted truncate"
                >
                    {reasoningInfo.effort}{#if reasoningInfo.budget}
                        · {reasoningInfo.budget.toLocaleString()} tok{/if}
                </span>
            {/if}
            {#if currentModel}
                <button
                    class="text-[10px] md:text-[11px] font-mono text-text-muted hover:text-accent truncate text-left"
                    onclick={() => onCommand("__open_model_picker", "")}
                    type="button"
                >
                    {shortenModel(currentModel)}
                </button>
            {/if}
        </div>
    </div>

    {#if visible}
        <div
            class="absolute left-4 right-4 md:left-8 md:right-8 bottom-full mb-1 max-w-4xl mx-auto"
        >
            <div
                class="bg-bg-code border border-border-default rounded-[8px] overflow-hidden max-h-[280px] overflow-y-auto"
            >
                {#each suggestions as suggestion, index (suggestion.command)}
                    <button
                        class="w-full text-left px-4 py-2.5 flex items-center gap-3 {index ===
                        selectedIndex
                            ? 'bg-bg-elevated'
                            : 'hover:bg-bg-elevated/50'}"
                        onclick={() => acceptSuggestion(suggestion)}
                        data-suggestion-selected={index === selectedIndex}
                        type="button"
                    >
                        <span
                            class="text-[13px] font-mono text-accent min-w-[140px]"
                            >{suggestion.label}</span
                        >
                        <span class="text-[12px] text-text-tertiary"
                            >{suggestion.description}</span
                        >
                        {#if suggestion.kind === "model" && suggestion.label === currentModel}
                            <span
                                class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-text-inverse"
                                >active</span
                            >
                        {/if}
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>
