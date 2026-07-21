<script lang="ts">
    import { tick } from "svelte";
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";
    import CommandMenu from "$lib/CommandMenu.svelte";
    import AttachmentTray from "$lib/chat/composer/AttachmentTray.svelte";
    import CommandSuggestions from "$lib/chat/composer/CommandSuggestions.svelte";
    import FileSuggestions from "$lib/chat/composer/FileSuggestions.svelte";
    import ComposerMetaBar from "$lib/chat/composer/ComposerMetaBar.svelte";
    import QueuedSteeringList from "$lib/chat/composer/QueuedSteeringList.svelte";
    import {
        ACCEPTED_IMAGE_TYPES,
        readClipboardItemsAsAttachments,
        readFilesAsAttachments,
    } from "$lib/chat/composer/attachments";
    import {
        buildComposerSuggestions,
        type Suggestion,
    } from "$lib/chat/composer/commands";
    import { shortenModel } from "$lib/chat/helpers";
    import type { SteeringQueueItem } from "$lib/chat/types";
    import type { ChatAttachment } from "$lib/chump/types";
    import type { FileSearchResult } from "$lib/chump/types";
    import { searchFiles, type ChumpApiTarget } from "$lib/chump/api";
    import type { ModelChoice } from "$lib/models";

    let {
        composerText = $bindable(),
        composerAttachments = $bindable([]),
        canSend,
        isSending,
        isCompacting = false,
        models = [],
        skills = [],
        currentModel = "",
        workspaceRoot = "",
        serverUrl = "",
        apiTarget = null,
        gitBranch = "",
        reasoningInfo = null,
        contextUsageLabel = null,
        steeringQueue = [],
        onSend,
        onDeleteSteering,
        onEditSteering,
        onCommand,
        onAbort,
        onScrollToBottom,
        isLoadingSession = false,
    } = $props<{
        composerText: string;
        composerAttachments: ChatAttachment[];
        canSend: boolean;
        isSending: boolean;
        isCompacting?: boolean;
        models: ModelChoice[];
        skills?: Array<{ name: string; description: string }>;
        currentModel: string;
        workspaceRoot: string;
        serverUrl: string;
        apiTarget?: ChumpApiTarget | null;
        gitBranch: string;
        reasoningInfo: { effort: string | null; budget: number | null } | null;
        contextUsageLabel: string | null;
        steeringQueue: SteeringQueueItem[];
        onSend: () => void;
        onDeleteSteering: (index: number) => void;
        onEditSteering: (index: number) => void;
        onCommand: (command: string, args: string) => void | Promise<void>;
        onAbort: () => void;
        onScrollToBottom?: () => void;
        isLoadingSession?: boolean;
    }>();

    let textareaElement = $state<HTMLTextAreaElement | null>(null);
    let fileInputElement = $state<HTMLInputElement | null>(null);
    let selectedIndex = $state(0);
    let menuOpen = $state(false);
    let isDraggingOver = $state(false);
    let dragCounter = 0;
    let fileSuggestions = $state<FileSearchResult[]>([]);
    let fileMenuOpen = $state(false);
    let fileSearchLoading = $state(false);
    let mentionRange = $state<{ start: number; end: number } | null>(null);
    let searchSequence = 0;

    const suggestions = $derived(
        buildComposerSuggestions(composerText, models, skills),
    );
    const visible = $derived(suggestions.length > 0 && menuOpen);
    const fileVisible = $derived(fileMenuOpen && mentionRange !== null);
    const isCommand = $derived(composerText.trim().startsWith("/"));
    const currentThinking = $derived(reasoningInfo?.effort ?? "");
    const hasAttachments = $derived(composerAttachments.length > 0);

    async function addAttachments(files: Iterable<File>) {
        const newAttachments = await readFilesAsAttachments(files);
        if (newAttachments.length === 0) {
            return;
        }
        composerAttachments = [...composerAttachments, ...newAttachments];
    }

    async function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        const imageItems = Array.from(items).filter((item) =>
            item.type.startsWith("image/"),
        );
        if (imageItems.length === 0) {
            return;
        }

        event.preventDefault();
        const newAttachments = await readClipboardItemsAsAttachments(imageItems);
        if (newAttachments.length === 0) {
            return;
        }

        composerAttachments = [...composerAttachments, ...newAttachments];
    }

    function handleDragEnter(event: DragEvent) {
        event.preventDefault();
        dragCounter += 1;
        if (event.dataTransfer?.types.includes("Files")) {
            isDraggingOver = true;
        }
    }

    function handleDragLeave(event: DragEvent) {
        event.preventDefault();
        dragCounter -= 1;
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
            void addAttachments(Array.from(files));
        }
    }

    function removeAttachment(index: number) {
        composerAttachments = composerAttachments.filter(
            (_attachment: ChatAttachment, attachmentIndex: number) =>
                attachmentIndex !== index,
        );
    }

    function openFilePicker() {
        fileInputElement?.click();
    }

    function handleFileInputChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            void addAttachments(Array.from(input.files));
            input.value = "";
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (fileVisible) {
            switch (event.key) {
                case "ArrowDown":
                    event.preventDefault();
                    if (fileSuggestions.length > 0) {
                        selectedIndex =
                            (selectedIndex + 1) % fileSuggestions.length;
                        scrollSelectedIntoView();
                    }
                    return;
                case "ArrowUp":
                    event.preventDefault();
                    if (fileSuggestions.length > 0) {
                        selectedIndex =
                            (selectedIndex - 1 + fileSuggestions.length) %
                            fileSuggestions.length;
                        scrollSelectedIntoView();
                    }
                    return;
                case "Enter":
                case "Tab":
                    if (fileSuggestions[selectedIndex]) {
                        event.preventDefault();
                        acceptFileSuggestion(fileSuggestions[selectedIndex]);
                    }
                    return;
                case "Escape":
                    event.preventDefault();
                    closeFileMenu();
                    return;
            }
        }

        if (!visible) {
            if (event.key === "/" && !composerText) {
                menuOpen = true;
                selectedIndex = 0;
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                insertNewlineAtCursor();
                return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                onSend();
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
                    (selectedIndex - 1 + suggestions.length) % suggestions.length;
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
        if (trimmed === "/compact") {
            void onCommand("compact", "");
            return;
        }
        if (trimmed === "/new") {
            void onCommand("new", "");
            return;
        }
        if (trimmed.startsWith("/model ")) {
            void onCommand("model", trimmed.slice("/model ".length).trim());
            return;
        }
        if (trimmed.startsWith("/thinking ")) {
            void onCommand(
                "thinking",
                trimmed.slice("/thinking ".length).trim(),
            );
            return;
        }
        if (trimmed.startsWith("/skill:")) {
            void onCommand("skill", trimmed.slice("/skill:".length).trim());
        }
    }

    function scrollSelectedIntoView() {
        void tick().then(() => {
            const element = document.querySelector(
                '[data-suggestion-selected="true"]',
            );
            element?.scrollIntoView({ block: "nearest" });
        });
    }

    function handleInput() {
        updateFileSuggestions();
        if (!composerText.startsWith("/")) {
            menuOpen = false;
            return;
        }
        menuOpen = true;
        selectedIndex = 0;
    }

    function updateFileSuggestions() {
        const cursor = textareaElement?.selectionStart ?? composerText.length;
        const beforeCursor = composerText.slice(0, cursor);
        const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
        if (!match || !apiTarget) {
            closeFileMenu();
            return;
        }

        const query = match[1] ?? "";
        mentionRange = {
            start: cursor - query.length - 1,
            end: cursor,
        };
        fileMenuOpen = true;
        menuOpen = false;
        selectedIndex = 0;
        const sequence = ++searchSequence;
        fileSearchLoading = true;
        void searchFiles(apiTarget, query, 20)
            .then((files) => {
                if (sequence !== searchSequence) return;
                fileSuggestions = files;
            })
            .catch(() => {
                if (sequence !== searchSequence) return;
                fileSuggestions = [];
            })
            .finally(() => {
                if (sequence === searchSequence) {
                    fileSearchLoading = false;
                }
            });
    }

    function acceptFileSuggestion(file: FileSearchResult) {
        if (!mentionRange) return;
        const replacement = `@${file.path} `;
        composerText =
            composerText.slice(0, mentionRange.start) +
            replacement +
            composerText.slice(mentionRange.end);
        const cursor = mentionRange.start + replacement.length;
        closeFileMenu();
        void tick().then(() => {
            textareaElement?.focus();
            textareaElement?.setSelectionRange(cursor, cursor);
        });
    }

    function closeFileMenu() {
        searchSequence += 1;
        fileMenuOpen = false;
        fileSearchLoading = false;
        mentionRange = null;
        fileSuggestions = [];
    }

    function insertNewlineAtCursor() {
        const cursor = textareaElement?.selectionStart ?? composerText.length;
        const selectionEnd = textareaElement?.selectionEnd ?? cursor;
        composerText = `${composerText.slice(0, cursor)}\n${composerText.slice(selectionEnd)}`;
        const nextCursor = cursor + 1;
        void tick().then(() => {
            textareaElement?.focus();
            textareaElement?.setSelectionRange(nextCursor, nextCursor);
        });
    }
</script>

<div
    class="w-full px-2 md:px-8 pb-4 md:pb-6 pt-2 bg-bg-surface relative first:rounded-t-lg"
    role="region"
    ondragenter={handleDragEnter}
    ondragleave={handleDragLeave}
    ondragover={handleDragOver}
    ondrop={handleDrop}
>
    {#if onScrollToBottom}
        <div
            class="absolute left-1/2 -top-10 -translate-x-1/2 z-30 transition-opacity opacity-80 hover:opacity-100"
        >
            <button
                onclick={onScrollToBottom}
                class="inline-flex items-center gap-1 rounded-[9px] border border-border-default bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary transition-all hover:border-border-hover hover:bg-bg-hover hover:text-text-main"
            >
                <svg
                    class="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    ></path></svg
                >
                Scroll to bottom
            </button>
        </div>
    {/if}

    {#if isDraggingOver}
        <div
            class="absolute inset-0 z-20 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none"
        >
            <span class="text-accent text-sm font-medium">Drop images here</span>
        </div>
    {/if}

    {#if hasAttachments}
        <AttachmentTray
            attachments={composerAttachments}
            onRemove={removeAttachment}
        />
    {/if}

    <div class="max-w-4xl mx-auto relative z-10 flex flex-col w-full">
        {#if steeringQueue.length > 0}
            <QueuedSteeringList
                {steeringQueue}
                onDelete={onDeleteSteering}
                onEdit={onEditSteering}
            />
        {/if}

        <div
            class="flex flex-col rounded-[8px] border border-border-default bg-bg-code focus-within:border-border-hover relative group"
        >
            <img
                src="/favicon.svg"
                alt="Chump logo"
                class="w-12 h-12 mb-6 absolute top-0 left-0 group-hover:-top-9 transition-all duration-300 -z-10"
            />

            <textarea
                aria-label="Message Chump"
                bind:this={textareaElement}
                bind:value={composerText}
                rows="2"
                placeholder={isLoadingSession ? "Loading session..." : "Message Chump..."}
                onkeydown={handleKeydown}
                oninput={handleInput}
                onpaste={handlePaste}
                disabled={isLoadingSession}
                class="w-full resize-none rounded-t-[8px] border-none bg-transparent px-3 md:px-4 py-2 md:py-2.5 text-md text-text-secondary placeholder:text-text-muted focus:outline-none min-h-[48px] md:min-h-[56px] max-h-[200px] md:max-h-[300px] disabled:opacity-50"
            ></textarea>

            <div
                class="flex items-center justify-between rounded-b-[8px] border-t border-border-default px-2 md:px-3 py-1.5"
            >
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label="Attach image"
                        class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated rounded-[6px] transition-colors disabled:opacity-50"
                        onclick={openFilePicker}
                        disabled={isLoadingSession}
                    >
                        <svg
                            class="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            ></path>
                        </svg>
                    </button>
                    <input
                        bind:this={fileInputElement}
                        type="file"
                        aria-label="Upload images"
                        accept={ACCEPTED_IMAGE_TYPES}
                        multiple
                        class="hidden"
                        onchange={handleFileInputChange}
                    />
                    {#if isCompacting || isSending}
                        <span
                            class="flex items-center gap-1.5 text-[13px] text-text-tertiary"
                            aria-live="polite"
                        >
                            <BrailleSpinner
                                class="font-mono text-[15px] text-text-highlight"
                            />
                            {isCompacting ? "Compacting..." : "Working..."}
                        </span>
                    {:else if !composerText.trim() && !hasAttachments}
                        {#if !isLoadingSession}
                            <CommandMenu
                                {models}
                                {currentModel}
                                {currentThinking}
                                {onCommand}
                            />
                        {/if}
                    {/if}
                </div>
                <div class="flex items-center gap-2">
                    {#if contextUsageLabel}
                        <span
                            class="text-[10px] md:text-[11px] font-mono text-text-muted mr-1 md:mr-2 tracking-wide hidden sm:inline select-none"
                            title="Enter sends · ⌘ Enter inserts a new line"
                            >{contextUsageLabel}</span
                        >
                    {/if}
                    {#if isSending && !isCompacting && !composerText.trim() && !hasAttachments}
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
                            class="flex h-7 w-7 items-center justify-center rounded-[6px] border border-transparent bg-bg-elevated text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50 md:h-8 md:w-8"
                            onclick={onSend}
                            disabled={!canSend || (isCommand && !hasAttachments)}
                        >
                            <svg
                                class="w-3.5 h-3.5 md:w-4 md:h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
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

            {#if visible}
                <CommandSuggestions
                    {suggestions}
                    {selectedIndex}
                    onSelect={acceptSuggestion}
                />
            {/if}
            {#if fileVisible}
                <FileSuggestions
                    files={fileSuggestions}
                    selectedIndex={selectedIndex}
                    loading={fileSearchLoading}
                    onSelect={acceptFileSuggestion}
                />
            {/if}
        </div>
    </div>

    <ComposerMetaBar
        {workspaceRoot}
        {gitBranch}
        {currentModel}
        {reasoningInfo}
        {shortenModel}
        onOpenModelPicker={() => onCommand("__open_model_picker", "")}
    />
</div>
