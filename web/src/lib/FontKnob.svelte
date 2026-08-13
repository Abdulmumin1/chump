<script lang="ts">
    import { onMount } from "svelte";
    import {
        FONT_OPTIONS,
        getActiveFontId,
        setBodyFont,
        loadFontStylesheet,
        type FontOption,
    } from "$lib/fonts";

    let activeFont = $state<FontOption>(FONT_OPTIONS[0]);
    let isOpen = $state(false);
    let previewFont = $state<FontOption | null>(null);

    onMount(() => {
        const id = getActiveFontId();
        activeFont = setBodyFont(id);

        // Preload external stylesheets in background for instant hover preview
        FONT_OPTIONS.forEach((f) => {
            if (f.googleFontUrl) {
                loadFontStylesheet(f.googleFontUrl);
            }
        });
    });

    function selectFont(font: FontOption) {
        activeFont = setBodyFont(font.id);
        previewFont = null;
        isOpen = false;
    }

    function applyTempFont(font: FontOption) {
        if (typeof document !== "undefined") {
            document.documentElement.style.setProperty("--body-font-family", font.family);
            document.documentElement.style.setProperty("--font-sans", font.family);
            document.body.style.setProperty("--body-font-family", font.family);
            document.body.style.setProperty("--font-sans", font.family);
            document.body.style.fontFamily = font.family;
        }
    }

    function handleMouseEnter(font: FontOption) {
        previewFont = font;
        applyTempFont(font);
    }

    function handleMouseLeave() {
        previewFont = null;
        applyTempFont(activeFont);
    }

    function toggleMenu() {
        isOpen = !isOpen;
    }
</script>

<div class="relative inline-block text-left">
    <!-- Font Knob Trigger Button -->
    <button
        type="button"
        onclick={toggleMenu}
        class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated/80 hover:bg-bg-hover text-text-main border border-border-default shadow-xs transition-all cursor-pointer group"
        title="Change Body Font"
    >
        <span class="font-serif font-bold text-sm text-text-highlight group-hover:scale-110 transition-transform">Aa</span>
        <span class="truncate max-w-[110px]">{activeFont.name}</span>
        <svg
            class="w-3.5 h-3.5 text-text-tertiary group-hover:text-text-main transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
    </button>

    <!-- Font Picker Popover -->
    {#if isOpen}
        <!-- Backdrop to close on click outside -->
        <button
            type="button"
            tabindex="-1"
            class="fixed inset-0 z-40 cursor-default bg-transparent"
            onclick={() => {
                if (previewFont) handleMouseLeave();
                isOpen = false;
            }}
            aria-label="Close font selector"
        ></button>

        <div
            class="absolute bottom-full left-0 mb-2 z-50 w-80 bg-bg-surface border border-border-default rounded-xl shadow-2xl p-2 flex flex-col gap-1 text-xs text-text-main transition-all"
        >
            <div class="px-2.5 py-2 border-b border-border-default/50 flex items-center justify-between">
                <div>
                    <span class="font-semibold text-text-main text-xs">Body Font Options</span>
                    <p class="text-[10px] text-text-tertiary">Hover to preview live, click to switch body font</p>
                </div>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-elevated text-text-tertiary">
                    {FONT_OPTIONS.length} fonts
                </span>
            </div>

            <div class="max-h-72 overflow-y-auto space-y-1 p-1 scrollbar-thin">
                {#each FONT_OPTIONS as font (font.id)}
                    {@const isSelected = font.id === activeFont.id}
                    <button
                        type="button"
                        onclick={() => selectFont(font)}
                        onmouseenter={() => handleMouseEnter(font)}
                        onmouseleave={handleMouseLeave}
                        class="w-full text-left p-2 rounded-lg flex flex-col gap-1 transition-colors group cursor-pointer {isSelected
                            ? 'bg-accent/15 border border-accent/40 text-text-main font-medium'
                            : 'hover:bg-bg-hover/80 text-text-secondary border border-transparent hover:text-text-main'}"
                    >
                        <div class="flex items-center justify-between w-full">
                            <span class="font-semibold text-xs" style="font-family: {font.family}">
                                {font.name}
                            </span>
                            <span
                                class="text-[9.5px] font-mono px-1.5 py-0.2 rounded text-text-tertiary bg-bg-hover group-hover:bg-bg-elevated"
                            >
                                {font.category}
                            </span>
                        </div>

                        <!-- Live Sample Text in the exact font -->
                        <div
                            class="text-[12px] leading-tight opacity-90 truncate text-text-main"
                            style="font-family: {font.family}"
                        >
                            The quick brown fox jumps over 123
                        </div>

                        <p class="text-[10px] text-text-tertiary leading-normal line-clamp-1">
                            {font.description}
                        </p>
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>
