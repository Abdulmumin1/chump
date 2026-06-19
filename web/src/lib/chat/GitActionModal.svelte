<script lang="ts">
    import { tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import BrailleSpinner from "$lib/BrailleSpinner.svelte";

    export type GitActionKind = "commit-push" | "create-pr";

    let {
        open = false,
        action = "commit-push",
        branch = "",
        changedFiles = 0,
        added = 0,
        removed = 0,
        files = [],
        selectedFiles = $bindable(),
        busy = false,
        error = "",
        commitMessage = $bindable(),
        prTitle = $bindable(),
        prBody = $bindable(),
        prDraft = $bindable(),
        resultUrl = "",
        onClose,
        onSubmit,
        onOpenResult,
    } = $props<{
        open: boolean;
        action?: GitActionKind;
        branch?: string;
        changedFiles?: number;
        added?: number;
        removed?: number;
        files?: string[];
        selectedFiles: string[];
        busy?: boolean;
        error?: string;
        commitMessage: string;
        prTitle: string;
        prBody: string;
        prDraft: boolean;
        resultUrl?: string;
        onClose: () => void;
        onSubmit: () => void | Promise<void>;
        onOpenResult: (url: string) => void;
    }>();

    let commitInput = $state<HTMLInputElement | null>(null);
    let prTitleInput = $state<HTMLInputElement | null>(null);

    const title = $derived(
        action === "commit-push"
            ? "Commit & push"
            : "Create pull request",
    );
    const primaryLabel = $derived(
        action === "commit-push"
            ? "Commit & Push"
            : "Create PR",
    );
    const helperText = $derived(
        action === "commit-push"
            ? "Stage selected workspace changes, commit them with this message, then push the branch to origin."
            : "Create a pull request from the current branch. Leave title and description empty to let GitHub CLI generate them from commits.",
    );
    const canSubmit = $derived(
        !busy &&
            !resultUrl &&
            (action !== "commit-push" ||
                (commitMessage.trim().length > 0 && selectedFiles.length > 0)),
    );

    $effect(() => {
        if (!open) return;
        void tick().then(() => {
            if (action === "commit-push") {
                commitInput?.focus();
            } else {
                prTitleInput?.focus();
            }
        });
    });

    function submit(): void {
        if (!canSubmit) return;
        void onSubmit();
    }

    function isSelected(file: string): boolean {
        return selectedFiles.includes(file);
    }

    function toggleFile(file: string): void {
        selectedFiles = isSelected(file)
            ? selectedFiles.filter((item: string) => item !== file)
            : [...selectedFiles, file];
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape" && open && !busy) {
            onClose();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-bg-overlay/60 p-4 backdrop-blur-[2px] cursor-default"
        transition:fade={{ duration: 150 }}
        onclick={() => {
            if (!busy) onClose();
        }}
    >
        <div
            class="flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabindex="-1"
            transition:fly={{ y: 8, duration: 150 }}
            onclick={(event) => event.stopPropagation()}
        >
            <div class="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                <div class="min-w-0">
                    <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">
                        Git action
                    </div>
                    <div class="mt-0.5 truncate text-[14px] font-semibold text-text-main">
                        {title}
                    </div>
                </div>
                <button
                    type="button"
                    class="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40"
                    aria-label="Close"
                    disabled={busy}
                    onclick={onClose}
                >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="space-y-3 px-4 py-4">
                <div class="rounded-md border border-border-subtle bg-bg-elevated p-3">
                    <div class="flex items-center justify-between gap-4">
                        <div class="flex min-w-0 items-center gap-2">
                            <svg class="h-4 w-4 shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 3v12m0 0a3 3 0 1 0 3 3m-3-3a3 3 0 1 1-3 3m13-3V9m0 0a3 3 0 1 0-3-3m3 3a3 3 0 1 1 3-3M7 8h10" />
                            </svg>
                            <span class="min-w-0 truncate font-mono text-[12px] text-text-secondary">
                                {branch || "current branch"}{#if action === "create-pr"} -> main{/if}
                            </span>
                        </div>
                        <div class="flex shrink-0 items-center gap-2 font-mono text-[12px]">
                            <span class="text-text-success">+{added}</span>
                            <span class="text-text-error">-{removed}</span>
                            <span class="text-text-tertiary">~{changedFiles}</span>
                        </div>
                    </div>
                </div>

                <p class="text-[12px] leading-relaxed text-text-tertiary">
                    {helperText}
                </p>

                {#if action === "commit-push"}
                    <div class="space-y-2">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                                Files to stage
                            </span>
                            <div class="flex items-center gap-2 text-[10px]">
                                <button
                                    type="button"
                                    class="text-text-tertiary transition-colors hover:text-text-main disabled:opacity-40"
                                    disabled={busy || selectedFiles.length === files.length}
                                    onclick={() => (selectedFiles = [...files])}
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    class="text-text-tertiary transition-colors hover:text-text-main disabled:opacity-40"
                                    disabled={busy || selectedFiles.length === 0}
                                    onclick={() => (selectedFiles = [])}
                                >
                                    None
                                </button>
                            </div>
                        </div>
                        <div class="max-h-36 overflow-y-auto rounded-md border border-border-subtle bg-bg-elevated">
                            {#each files as file (file)}
                                <label class="flex cursor-pointer items-center gap-2 border-b border-border-subtle/60 px-2.5 py-2 last:border-b-0 hover:bg-bg-hover/50">
                                    <input
                                        type="checkbox"
                                        class="h-3.5 w-3.5 accent-accent"
                                        checked={isSelected(file)}
                                        disabled={busy}
                                        onchange={() => toggleFile(file)}
                                    />
                                    <span class="min-w-0 truncate font-mono text-[11px] text-text-secondary">
                                        {file}
                                    </span>
                                </label>
                            {:else}
                                <div class="px-3 py-4 text-center text-[11px] text-text-tertiary">
                                    No touched files recorded for this session.
                                </div>
                            {/each}
                        </div>
                        <div class="text-[10px] text-text-tertiary">
                            {selectedFiles.length} of {files.length} selected
                        </div>
                    </div>

                    <label class="block">
                        <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                            Commit message
                        </span>
                        <input
                            bind:this={commitInput}
                            bind:value={commitMessage}
                            class="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted transition-colors focus:border-accent/60 focus:outline-none"
                            placeholder="Describe the change..."
                            autocomplete="off"
                            onkeydown={(event) => {
                                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                    submit();
                                }
                            }}
                        />
                    </label>
                {:else}
                    {#if resultUrl}
                        <div class="rounded-md border border-success/20 bg-success/5 p-3">
                            <div class="text-[12px] font-semibold text-text-main">
                                Pull request created
                            </div>
                            <a
                                class="mt-2 flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 font-mono text-[11px] text-accent transition-colors hover:border-accent/40 hover:bg-bg-hover"
                                href={resultUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <span class="min-w-0 truncate">{resultUrl}</span>
                                <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 17L17 7M9 7h8v8" />
                                </svg>
                            </a>
                        </div>
                    {:else}
                        <label class="block">
                            <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                                Title
                            </span>
                            <input
                                bind:this={prTitleInput}
                                bind:value={prTitle}
                                class="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted transition-colors focus:border-accent/60 focus:outline-none"
                                placeholder="Leave empty to generate"
                                autocomplete="off"
                            />
                        </label>

                        <label class="block">
                            <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                                Description
                            </span>
                            <textarea
                                bind:value={prBody}
                                class="min-h-28 w-full resize-y rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted transition-colors focus:border-accent/60 focus:outline-none"
                                placeholder="Leave empty to generate"
                            ></textarea>
                        </label>

                        <div class="rounded-md border border-border-subtle bg-bg-elevated p-1">
                            <button
                                type="button"
                                class="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-[13px] transition-colors hover:bg-bg-hover {prDraft ? 'bg-bg-hover text-text-main' : 'text-text-secondary'}"
                                onclick={() => (prDraft = true)}
                            >
                                <span class="flex h-4 w-4 items-center justify-center rounded-full border border-border-default text-[10px]">
                                    {#if prDraft}✓{/if}
                                </span>
                                <span>Create draft PR</span>
                            </button>
                            <button
                                type="button"
                                class="mt-1 flex w-full items-center gap-3 rounded px-3 py-2 text-left text-[13px] transition-colors hover:bg-bg-hover {!prDraft ? 'bg-bg-hover text-text-main' : 'text-text-secondary'}"
                                onclick={() => (prDraft = false)}
                            >
                                <span class="flex h-4 w-4 items-center justify-center rounded-full border border-border-default text-[10px]">
                                    {#if !prDraft}✓{/if}
                                </span>
                                <span>Create PR</span>
                            </button>
                        </div>
                    {/if}
                {/if}

                {#if error}
                    <div class="rounded-md border border-error/15 bg-error/5 px-3 py-2 text-[11px] leading-relaxed text-error">
                        {error}
                    </div>
                {/if}
            </div>

            <div class="flex items-center justify-end gap-2 border-t border-border-subtle bg-bg-elevated/50 px-4 py-3">
                <button
                    type="button"
                    class="h-8 rounded-md px-3 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40"
                    disabled={busy}
                    onclick={onClose}
                >
                    {resultUrl ? "Close" : "Cancel"}
                </button>
                {#if resultUrl}
                    <button
                        type="button"
                        class="flex h-8 items-center justify-center gap-2 rounded-md bg-accent px-3 text-[12px] font-bold text-text-on-accent transition-colors hover:bg-accent-hover"
                        onclick={() => onOpenResult(resultUrl)}
                    >
                        Open PR
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 17L17 7M9 7h8v8" />
                        </svg>
                    </button>
                {:else}
                <button
                    type="button"
                    class="flex h-8 min-w-[92px] items-center justify-center rounded-md bg-accent px-3 text-[12px] font-bold text-text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                    disabled={!canSubmit}
                    onclick={submit}
                >
                    {#if busy}
                        <BrailleSpinner class="font-mono text-[14px]" />
                    {:else}
                        {primaryLabel}
                    {/if}
                </button>
                {/if}
            </div>
        </div>
    </div>
{/if}
