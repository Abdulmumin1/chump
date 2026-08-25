/**
 * Streamdown theme mapped onto this app's design tokens so streaming markdown
 * matches the rest of the transcript. Streamdown styles each element through
 * these Tailwind class strings instead of the legacy `.markdown-body` CSS.
 *
 * Colors here resolve against the `@theme` tokens in `src/app.css`
 * (bg-*, text-*, border-*), so light/dark are handled automatically.
 */
export const markdownTheme = {
    link: {
        base: "font-medium text-text-inverse underline underline-offset-2 hover:text-text-main",
        blocked: "text-text-muted",
    },
    h1: { base: "mb-3 text-3xl font-semibold text-text-inverse" },
    h2: { base: "mb-3 text-2xl font-semibold text-text-inverse" },
    h3: { base: "mb-3 text-xl font-semibold text-text-inverse" },
    h4: { base: "mb-3 text-lg font-semibold text-text-inverse" },
    h5: { base: "mb-3 text-base font-semibold text-text-inverse" },
    h6: { base: "mb-3 text-sm font-semibold text-text-inverse" },
    paragraph: { base: "mb-4 min-w-0 wrap-anywhere" },
    ul: { base: "mb-4 pl-6 list-disc min-w-0 wrap-anywhere" },
    ol: { base: "mb-4 pl-6 list-decimal min-w-0 wrap-anywhere" },
    li: { base: "my-1", checkbox: "mr-2" },
    code: {
        base: "my-4 overflow-hidden rounded-lg border border-border-default bg-bg-code-block",
        container: "overflow-x-auto p-4",
        header: "hidden",
        buttons: "flex items-center gap-2",
        language: "font-mono lowercase text-text-tertiary text-xs",
        skeleton: "block rounded-md font-mono text-transparent bg-bg-elevated animate-pulse",
        pre: "font-mono text-[13px] leading-relaxed text-text-code",
        line: "block",
    },
    codespan: {
        base: "rounded-[6px] border border-border-default bg-bg-code px-[0.35rem] py-[0.08rem] font-mono text-[0.92em] text-text-code break-words [box-decoration-break:clone]",
    },
    image: {
        base: "my-4 mx-auto block w-fit",
        image: "max-w-full rounded-lg",
    },
    blockquote: {
        base: "mb-4 border-l-2 border-border-default pl-4 text-text-muted min-w-0 wrap-anywhere",
    },
    alert: {
        base: "my-4 border-l-4 p-4",
        title: "text-sm font-semibold flex items-center gap-2 mb-2 capitalize",
        icon: "size-5",
        note: "border-border-default text-text-secondary",
        tip: "border-border-default text-text-secondary",
        warning: "border-border-default text-text-warning",
        caution: "border-border-default text-text-error",
        important: "border-border-default text-text-inverse",
    },
    table: {
        base: "my-4 w-full overflow-x-auto rounded-lg border border-border-default",
        table: "w-full border-collapse",
    },
    thead: { base: "bg-bg-surface-alt" },
    tbody: { base: "" },
    tfoot: { base: "border-t border-border-default" },
    tr: { base: "border-b border-border-subtle hover:bg-bg-hover/50" },
    td: {
        base: "px-3 py-2 text-[13px] text-text-secondary min-w-[120px] break-words",
    },
    th: {
        base: "px-3 py-2 text-left text-[13px] font-semibold text-text-inverse min-w-[120px] break-words",
    },
    sup: { base: "text-xs" },
    sub: { base: "text-xs" },
    hr: { base: "my-4 border-0 border-t border-border-default" },
    strong: { base: "font-semibold text-text-inverse" },
    mermaid: { base: "", icon: "size-5", buttons: "" },
    math: { block: "", inline: "" },
    br: { base: "" },
    em: { base: "italic" },
    del: { base: "text-text-muted" },
    footnoteRef: { base: "text-text-muted px-1 py-0.5 rounded-md bg-bg-code" },
    descriptionList: { base: "my-4 space-y-2" },
    descriptionTerm: {
        base: "font-semibold text-text-inverse border-l-2 border-border-default pl-4",
    },
    descriptionDetail: { base: "text-text-secondary ml-4 leading-relaxed" },
    inlineCitation: {
        preview:
            "text-sm text-text-secondary bg-bg-code rounded-md px-2 py-0.5 cursor-pointer inline-flex border border-border-default hover:bg-bg-elevated",
        carousel: {
            header: "flex items-center justify-between",
            stepCounter: "text-xs font-semibold text-text-tertiary tabular-nums",
            buttons: "flex items-center justify-end gap-2",
            title: "mb-2 line-clamp-2 font-semibold",
            url: "flex items-center gap-2 text-sm text-text-muted",
            favicon: "h-4 w-4 rounded",
        },
        list: {
            base: "grid gap-2",
            item: "grid gap-1 hover:bg-bg-elevated rounded-md p-2",
            title: "line-clamp-1 font-semibold text-sm",
            url: "flex items-center gap-2 text-xs text-text-muted",
            favicon: "h-3 w-3 rounded",
        },
    },
    components: {
        button:
            "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer p-1 text-text-tertiary transition-colors hover:text-text-inverse rounded hover:bg-bg-elevated w-6 h-6",
        popover:
            "min-w-[250px] max-w-md fixed z-[1000] max-h-md overflow-y-auto rounded-lg bg-bg-surface border border-border-default p-4 shadow",
    },
};
