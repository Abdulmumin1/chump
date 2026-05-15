<script lang="ts">
    import { tick } from "svelte";
    import CommandMenu from "./CommandMenu.svelte";

    import type { ModelChoice } from "$lib/models";
    import type { ChatAttachment } from "$lib/chump/types";

    const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    };

    const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

    function fileToAttachment(file: File): Promise<ChatAttachment> {
        return new Promise((resolve, reject) => {
            const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "png");
            const mime = IMAGE_MIME_BY_EXTENSION[ext] ?? file.type ?? "image/png";
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(",")[1] ?? "";
                resolve({
                    type: "image",
                    label: `[Image: ${file.name}]`,
                    filename: file.name,
                    mime,
                    data: base64,
                });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async function blobToAttachment(blob: Blob, filename: string): Promise<ChatAttachment> {
        const ext = "." + (filename.split(".").pop()?.toLowerCase() ?? "png");
        const mime = IMAGE_MIME_BY_EXTENSION[ext] ?? blob.type ?? "image/png";
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(",")[1] ?? "";
                resolve({
                    type: "image",
                    label: `[Image: ${filename}]`,
                    filename,
                    mime,
                    data: base64,
                });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    let {
        composerText = $bindable(),
        composerAttachments = $bindable([]),
        activeSessionId,
        canSend,
        isSending,
        skills = [],
        models = [],
        currentModel = "",
        workspaceRoot = "",
        gitBranch = "",
        currentProvider = "",
        reasoningInfo = null,
        steeringQueue = [],
        onSend,
        onDeleteSteering,
        onEditSteering,
        onCommand,
        onAbort,
    } = $props<{
        composerText: string;
        composerAttachments: ChatAttachment[];
        activeSessionId: string;
        canSend: boolean;
        isSending: boolean;
        skills: Array<{ name: string; description: string }>;
        models: ModelChoice[];
        currentModel: string;
        currentProvider: string;
        workspaceRoot: string;
        gitBranch: string;
        reasoningInfo: { effort: string | null; budget: number | null } | null;
        steeringQueue: Array<{
            content: string;
            attachments?: Array<Record<string, unknown>>;
        }>;
        onSend: () => void;
        onDeleteSteering: (index: number) => void;
        onEditSteering: (index: number) => void;
        onCommand: (command: string, args: string) => void | Promise<void>;
        onAbort: () => void;
    }>();

    let textareaElement = $state<HTMLTextAreaElement | null>(null);
    let fileInputElement = $state<HTMLInputElement | null>(null);
    let selectedIndex = $state(0);
    let menuOpen = $state(false);
    let isDraggingOver = $state(false);
    let dragCounter = 0;

    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinnerFrame = $state(0);
    let spinnerTimer: ReturnType<typeof setInterval> | null = null;

    $effect(() => {
        if (isSending) {
            spinnerFrame = 0;
            spinnerTimer = setInterval(() => {
                spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
            }, 80);
        } else {
            if (spinnerTimer) clearInterval(spinnerTimer);
            spinnerTimer = null;
        }
        return () => {
            if (spinnerTimer) clearInterval(spinnerTimer);
        };
    });

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

        if (/^\/model(?:\s|$)/.test(trimmed)) {
            const query = trimmed.slice("/model".length).trim().toLowerCase();
            return models
                .filter(
                    (m: ModelChoice) =>
                        m.provider === currentProvider &&
                        (!query ||
                            m.label.toLowerCase().includes(query) ||
                            m.description.toLowerCase().includes(query)),
                )
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

        const hits = ROOT_COMMANDS.filter((c) => c.label.startsWith(trimmed));
        return hits.length > 0 ? hits : trimmed === "/" ? ROOT_COMMANDS : [];
    });

    let visible = $derived(suggestions.length > 0 && menuOpen);

    async function addFiles(files: FileList | File[]) {
        const newAttachments: ChatAttachment[] = [];
        for (const file of files) {
            if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
                try {
                    const attachment = await fileToAttachment(file);
                    newAttachments.push(attachment);
                } catch {
                    // skip files that fail to read
                }
            }
        }
        composerAttachments = [...composerAttachments, ...newAttachments];
    }

    function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        const imageItems: DataTransferItem[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith("image/")) {
                imageItems.push(item);
            }
        }

        if (imageItems.length > 0) {
            event.preventDefault();
            for (const item of imageItems) {
                const blob = item.getAsFile();
                if (blob) {
                    const ext = item.type === "image/png" ? ".png"
                        : item.type === "image/jpeg" ? ".jpg"
                        : item.type === "image/webp" ? ".webp"
                        : item.type === "image/gif" ? ".gif"
                        : ".png";
                    const filename = `clipboard${ext}`;
                    blobToAttachment(blob, filename).then((attachment) => {
                        composerAttachments = [...composerAttachments, attachment];
                    }).catch(() => {});
                }
            }
        }
    }

    function handleDragEnter(event: DragEvent) {
        event.preventDefault();
        dragCounter++;
        if (event.dataTransfer?.types.includes("Files")) {
            isDraggingOver = true;
        }
    }

    function handleDragLeave(event: DragEvent) {
        event.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            isDraggingOver = false;
        }
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        isDraggingOver = false;
        dragCounter = 0;
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            void addFiles(files);
        }
    }

    function removeAttachment(index: number) {
        composerAttachments = composerAttachments.filter(
            (_attachment: ChatAttachment, i: number) => i !== index,
        );
    }

    function openFilePicker() {
        fileInputElement?.click();
    }

    function handleFileInputChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            void addFiles(input.files);
            input.value = "";
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) {
            if (event.key === "/" && !composerText) {
                menuOpen = true;
                selectedIndex = 0;
            }
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
            composerText = suggestion.command;
            selectedIndex = 0;
            void tick().then(() => {
                textareaElement?.focus();
            });
            return;
        }

        menuOpen = false;
        composerText = "";
        void tick().then(() => {
            textareaElement?.focus();
        });

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
        const short = name.replace(/^workers_ai\/@cf\//, "");
        const parts = short.split("/");
        return parts.length > 1 ? parts.pop() || short : short;
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

    function attachmentThumbSrc(attachment: ChatAttachment): string {
        return `data:${attachment.mime};base64,${attachment.data}`;
    }

    let isCommand = $derived(composerText.trim().startsWith("/"));
    let currentThinking = $derived(reasoningInfo?.effort ?? "");
    let hasAttachments = $derived(composerAttachments.length > 0);
</script>

<div
    class="w-full px-2 md:px-8 pb-4 md:pb-6 pt-2 bg-bg-surface relative first:rounded-t-lg overflow-hidden"
    role="region"
    ondragenter={handleDragEnter}
    ondragleave={handleDragLeave}
    ondragover={handleDragOver}
    ondrop={handleDrop}
>
    {#if isDraggingOver}
        <div class="absolute inset-0 z-20 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
            <span class="text-accent text-sm font-medium">Drop images here</span>
        </div>
    {/if}

    {#if steeringQueue.length > 0}
        <div class="max-w-[90%] mx-auto space-y-2">
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

    {#if hasAttachments}
        <div class="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
            {#each composerAttachments as attachment, index (attachment.filename + index)}
                <div class="relative group w-16 h-16 rounded-md overflow-hidden border border-border-default bg-bg-code flex-shrink-0">
                    <img
                        src={attachmentThumbSrc(attachment)}
                        alt={attachment.filename}
                        class="w-full h-full object-cover"
                    />
                    <button
                        type="button"
                        aria-label="Remove attachment"
                        class="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-bg-surface/80 text-text-tertiary hover:bg-error hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        onclick={() => removeAttachment(index)}
                    >
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                    <span class="absolute bottom-0 left-0 right-0 text-[8px] text-text-inverse bg-black/50 truncate px-1 leading-relaxed">
                        {attachment.filename}
                    </span>
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
            onpaste={handlePaste}
            class="w-full bg-transparent border-none rounded-t-[8px] px-3 md:px-4 py-2.5 md:py-3 text-base text-text-secondary focus:outline-none resize-none min-h-[52px] md:min-h-[60px] max-h-[200px] md:max-h-[300px] placeholder:text-text-muted"
        ></textarea>

        <div
            class="flex justify-between items-center px-2 md:px-3 py-1.5 md:py-2 border-t border-border-default rounded-b-[8px]"
        >
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    aria-label="Attach image"
                    class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated rounded-[6px] transition-colors"
                    onclick={openFilePicker}
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                </button>
                <input
                    bind:this={fileInputElement}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    multiple
                    class="hidden"
                    onchange={handleFileInputChange}
                />
                {#if isSending}
                    <span
                        class="flex items-center gap-1.5 text-[13px] text-text-tertiary"
                    >
                        <span class="text-accent font-mono text-[15px]"
                            >{spinnerFrames[spinnerFrame]}</span
                        >
                        Working...
                    </span>
                {:else if !composerText.trim() && !hasAttachments}
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
                {#if isSending}
                    <button
                        aria-label="Abort"
                        class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-error/20 hover:bg-error/30 text-error rounded-[6px]"
                        onclick={onAbort}
                    >
                        <span
                            class="w-3 h-3 md:w-3.5 md:h-3.5 rounded-sm bg-error"
                        ></span>
                    </button>
                {:else}
                    <button
                        aria-label={isSending
                            ? "Queue message"
                            : "Send message"}
                        class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-bg-code text-text-tertiary hover:bg-bg-code hover:text-text-secondary rounded-[6px] disabled:opacity-50"
                        onclick={onSend}
                        disabled={!canSend || (isCommand && !hasAttachments)}
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
                {/if}
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
            {#if gitBranch}
                <svg class="w-3.5 h-3.5 text-text-muted opacity-50 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <line x1="6" x2="6" y1="3" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="truncate ml-1">{gitBranch}</span>
            {/if}
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
