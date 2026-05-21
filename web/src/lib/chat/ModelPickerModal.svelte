<script lang="ts">
    import { tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import type { ModelGroup } from "$lib/chat/types";

    let {
        open = false,
        groupedModels,
        currentModel,
        modelSearchQuery = $bindable(),
        shortenModel,
        onClose,
        onSelectModel,
    } = $props<{
        open: boolean;
        groupedModels: ModelGroup[];
        currentModel: string;
        modelSearchQuery: string;
        shortenModel: (name: string) => string;
        onClose: () => void;
        onSelectModel: (provider: string, model: string) => void | Promise<void>;
    }>();

    let modelSearchInput = $state<HTMLInputElement | null>(null);

    $effect(() => {
        if (!open) {
            return;
        }

        void tick().then(() => {
            modelSearchInput?.focus();
        });
    });
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-bg-overlay/60 backdrop-blur-[2px] w-full h-full border-none cursor-default"
        transition:fade={{ duration: 150 }}
        onclick={onClose}
    >
        <div
            class="flex max-h-[65vh] w-full flex-col overflow-hidden rounded-t-2xl border-x border-t border-border-subtle bg-bg-elevated md:max-w-md md:rounded-[12px] md:border"
            transition:fly={{ y: 200, duration: 250, opacity: 1 }}
            onclick={(event) => event.stopPropagation()}
        >
            <div class="md:hidden flex justify-center pt-3 pb-1">
                <div
                    class="w-12 h-1.5 bg-text-tertiary/20 rounded-full"
                    aria-hidden="true"
                ></div>
            </div>
            <div
                class="flex items-center justify-between px-4 py-3 border-b border-border-default"
            >
                <span class="text-[14px] font-medium text-text-secondary"
                    >Switch Model</span
                >
                <button
                    class="button-tertiary px-1.5 py-1 text-text-tertiary"
                    onclick={onClose}
                    aria-label="Close"
                >
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        ></path></svg
                    >
                </button>
            </div>
            <div class="px-3 py-3 border-b border-border-default bg-bg-elevated">
                <label for="model-search-input" class="sr-only"
                    >Search models</label
                >
                <input
                    bind:this={modelSearchInput}
                    type="text"
                    id="model-search-input"
                    bind:value={modelSearchQuery}
                    placeholder="Search models..."
                    class="w-full rounded-[9px] border border-border-subtle bg-bg-surface px-3 py-2 text-[14px] text-text-secondary placeholder:text-text-tertiary transition-all focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    autocomplete="off"
                />
            </div>
            <div
                class="overflow-y-auto py-1 bg-bg-elevated"
                role="listbox"
                aria-label="Available models"
            >
                {#each groupedModels as { provider, models } (provider)}
                    <div
                        class="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated/80 backdrop-blur-sm sticky top-0 z-10 border-b border-border-subtle/30"
                    >
                        {provider.replace(/_/g, " ")}
                    </div>
                    {#each models as model (model.label)}
                        <button
                            role="option"
                            aria-selected={model.label === currentModel}
                            onclick={() => {
                                void onSelectModel(model.provider, model.model);
                                onClose();
                            }}
                            class="group flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
                            type="button"
                        >
                            <div class="flex flex-col min-w-0 pr-4">
                                <span
                                    class="text-[13.5px] font-medium {model.label === currentModel
                                        ? 'text-text-primary'
                                        : 'text-text-secondary group-hover:text-text-primary'} transition-colors"
                                    >{model.name || shortenModel(model.model)}</span
                                >
                                {#if model.description}
                                    <div class="flex items-center gap-2 mt-0.5">
                                        <span
                                            class="text-[12px] text-text-tertiary truncate"
                                            >{model.description}</span
                                        >
                                    </div>
                                {/if}
                            </div>
                            {#if model.label === currentModel}
                                <div class="flex items-center gap-2">
                                    <span
                                        class="flex-shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[#111111]"
                                        >Active</span
                                    >
                                    <svg
                                        class="w-4 h-4 text-text-primary"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2.5"
                                            d="M5 13l4 4L19 7"
                                        />
                                    </svg>
                                </div>
                            {:else}
                                <div
                                    class="opacity-0 group-hover:opacity-100 transition-opacity"
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
                                            d="M9 5l7 7-7 7"
                                        />
                                    </svg>
                                </div>
                            {/if}
                        </button>
                    {/each}
                {:else}
                    <div class="px-4 py-12 text-center">
                        <div class="text-[14px] text-text-secondary font-medium">
                            No models found
                        </div>
                        <div class="text-[12px] text-text-tertiary mt-1">
                            Try a different search term
                        </div>
                    </div>
                {/each}
            </div>
            <div class="h-6 md:hidden bg-bg-elevated"></div>
        </div>
    </div>
{/if}
