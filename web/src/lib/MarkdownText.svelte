<script lang="ts">
    import { marked } from "marked";

    let { text, classes = "" } = $props<{ text: string; classes?: string }>();

    marked.setOptions({
        gfm: true,
        breaks: true,
    });

    let html = $derived(marked.parse(text) as string);
</script>

<div class="markdown-body text-[14px] leading-relaxed {classes} ">
    {@html html}
</div>

<style>
    :global(.markdown-body p) {
        margin: 0 0 1rem 0;
    }

    :global(.markdown-body p:last-child) {
        margin-bottom: 0;
    }

    :global(.markdown-body strong) {
        font-weight: 700;
        color: var(--text-inverse);
    }

    :global(.markdown-body em) {
        font-style: italic;
    }

    :global(.markdown-body code) {
        font-family:
            "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
        font-size: 0.92em;
        background: var(--bg-code);
        border: 1px solid var(--border-default);
        border-radius: 6px;
        padding: 0.08rem 0.35rem;
        color: var(--text-code);
    }

    :global(.markdown-body :not(pre) > code) {
        white-space: break-spaces;
        overflow-wrap: anywhere;
        word-break: break-word;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
    }

    :global(.markdown-body pre) {
        margin: 0 0 1rem 0;
        padding: 0.9rem 1rem;
        overflow-x: auto;
        background: var(--bg-code-block);
        border: 1px solid var(--border-default);
        border-radius: 8px;
    }

    :global(.markdown-body pre code) {
        background: transparent;
        border: 0;
        padding: 0;
        border-radius: 0;
        color: inherit;
    }

    :global(.markdown-body p),
    :global(.markdown-body li),
    :global(.markdown-body blockquote) {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    :global(.markdown-body ul),
    :global(.markdown-body ol) {
        margin: 0 0 1rem 0;
        padding-left: 1.4rem;
    }

    :global(.markdown-body li) {
        margin: 0.2rem 0;
    }

    :global(.markdown-body a) {
        color: var(--accent);
        text-decoration: none;
    }

    :global(.markdown-body a:hover) {
        text-decoration: underline;
    }

    :global(.markdown-body blockquote) {
        margin: 0 0 1rem 0;
        padding-left: 1rem;
        border-left: 2px solid var(--border-default);
        color: var(--text-muted);
    }

    :global(.markdown-body h1),
    :global(.markdown-body h2),
    :global(.markdown-body h3),
    :global(.markdown-body h4) {
        margin: 0 0 0.75rem 0;
        font-weight: 700;
        color: var(--text-inverse);
    }

    :global(.markdown-body hr) {
        margin: 1rem 0;
        border: 0;
        border-top: 1px solid var(--border-default);
    }

    :global(.markdown-body table) {
        display: block;
        width: calc(100% + 2rem);
        margin: 1.5rem -1rem;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        border-collapse: separate;
        border-spacing: 0;
        border: 1px solid var(--border-default);
        border-radius: 8px;
    }

    @media (min-width: 768px) {
        :global(.markdown-body table) {
            width: calc(100% + 4rem);
            margin-left: -2rem;
            margin-right: -2rem;
        }
    }

    :global(.markdown-body table::-webkit-scrollbar) {
        height: 6px;
    }

    :global(.markdown-body table::-webkit-scrollbar-track) {
        background: transparent;
    }

    :global(.markdown-body table::-webkit-scrollbar-thumb) {
        background: var(--border-default);
        border-radius: 3px;
    }

    :global(.markdown-body table::-webkit-scrollbar-thumb:hover) {
        background: var(--border-hover);
    }

    :global(.markdown-body th) {
        background: var(--bg-surface-alt);
        color: var(--text-inverse);
        font-weight: 600;
        text-align: left;
        padding: 0.65rem 0.95rem;
        border-bottom: 2px solid var(--border-default);
        font-size: 0.88em;
    }

    :global(.markdown-body td) {
        padding: 0.65rem 0.95rem;
        border-bottom: 1px solid var(--border-subtle);
        color: var(--text-secondary);
        font-size: 0.88em;
    }

    :global(.markdown-body tr:nth-child(even)) {
        background: var(--bg-surface-alt);
    }

    :global(.markdown-body tr:last-child td) {
        border-bottom: none;
    }

    :global(.markdown-body th:first-child) {
        border-top-left-radius: 7px;
    }

    :global(.markdown-body th:last-child) {
        border-top-right-radius: 7px;
    }

    :global(.markdown-body tr:last-child td:first-child) {
        border-bottom-left-radius: 7px;
    }

    :global(.markdown-body tr:last-child td:last-child) {
        border-bottom-right-radius: 7px;
    }
</style>
