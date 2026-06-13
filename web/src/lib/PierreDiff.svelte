<script lang="ts">
    import { browser } from "$app/environment";
    import { onDestroy } from "svelte";
    import {
        DIFFS_TAG_NAME,
        FileDiff,
        type FileDiffMetadata,
    } from "@pierre/diffs";
    // @ts-ignore side-effect web-component bundle is not typed
    import "../../node_modules/@pierre/diffs/dist/components/web-components.js";
    import type { AppTheme } from "$lib/theme";

    let {
        file,
        theme,
        class: className = "",
        style = "",
    } = $props<{
        file: FileDiffMetadata;
        theme: AppTheme;
        class?: string;
        style?: string;
    }>();

    let host = $state<HTMLElement | null>(null);
    let instance: FileDiff | null = null;

    $effect(() => {
        if (!browser || !host) return;

        if (!instance) {
            instance = new FileDiff({
                theme: {
                    dark: "pierre-dark",
                    light: "pierre-light",
                },
                themeType: theme,
                diffStyle: "unified",
                diffIndicators: "bars",
                hunkSeparators: "line-info-basic",
                overflow: "scroll",
            });
        } else {
            instance.setThemeType(theme);
        }

        instance.render({
            fileDiff: file,
            fileContainer: host,
            forceRender: true,
        });
    });

    onDestroy(() => {
        instance?.cleanUp();
        instance = null;
    });
</script>

<svelte:element
    this={DIFFS_TAG_NAME}
    bind:this={host}
    class={className}
    {style}
/>

<style>
    :global(.diff-mobile-scale) {
        font-size: var(--mobile-diff-font-size, 10px);
    }

    @media (min-width: 768px) {
        :global(.diff-mobile-scale) {
            font-size: var(--mobile-diff-font-size, 12px);
        }
    }
</style>
