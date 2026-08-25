<script lang="ts">
    import { Streamdown } from "svelte-streamdown";
    import { markdownTheme } from "$lib/chat/markdownTheme";

    let {
        text,
        classes = "",
        streaming = false,
    } = $props<{
        text: string;
        classes?: string;
        /** Enables Streamdown's incremental parser and word-level animation. */
        streaming?: boolean;
    }>();

    // The presentation scheduler already reveals whole words progressively.
    // Keep Streamdown's incremental Markdown parser, but do not add a second
    // fade animation to every word; that makes fast responses harder to read.
    const animation = $derived({
        enabled: false,
        type: "fade" as const,
        tokenize: "word" as const,
        duration: 180,
        timingFunction: "ease-out" as const,
        animateOnMount: false,
    });
</script>

<Streamdown
    content={text}
    class={`markdown-body text-[14px] leading-relaxed ${classes}`}
    theme={markdownTheme}
    static={!streaming}
    parseIncompleteMarkdown={streaming}
    {animation}
/>
