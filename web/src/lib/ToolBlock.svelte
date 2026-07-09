<script lang="ts">
    import { slide } from "svelte/transition";
    import ToolDiffBlock from "$lib/chat/tool/ToolDiffBlock.svelte";
    import { stringifyValue } from "$lib/chat/tool/diff";
    import type { TranscriptBlock } from "$lib/chat/types";

    let {
        block,
        expanded,
        onToggle,
    } = $props<{
        block: TranscriptBlock;
        expanded: boolean;
        onToggle: () => void;
    }>();

    let readFileRange = $derived.by(() => {
        if (
            block.originalToolName !== "read_file" &&
            block.originalToolName !== "view_file"
        ) {
            return "";
        }

        const args = block.args ?? {};
        const offset = typeof args.offset === "number" ? args.offset : null;
        const limit = typeof args.limit === "number" ? args.limit : null;
        if (offset === null && limit === null) return "";

        const parts: string[] = [];
        if (offset !== null) parts.push(`L${offset}`);
        if (limit !== null) parts.push(`+${limit}`);
        return parts.join(" ");
    });

    let isViewImage = $derived(block.originalToolName === "view_image");

    let imagePath = $derived.by(() => {
        if (!isViewImage) return "";
        return String(block.args?.path ?? "");
    });

    let expandedPreview = $derived.by(() => {
        if (block.kind !== "tool-call") {
            return block.text;
        }

        if (
            block.originalToolName === "read_file" ||
            block.originalToolName === "view_file"
        ) {
            const filePath = String(
                block.args?.file_path ?? block.args?.path ?? "",
            );
            return [filePath, readFileRange].filter(Boolean).join(" ");
        }

        if (isViewImage) return imagePath;

        return stringifyValue(block.args);
    });

    let statusLabel = $derived.by(() => {
        if (block.status === "error") return "Failed";
        if (block.status === "aborted") return "Aborted";
        if (block.status === "completed" || block.hasResult) {
            return "";
        }
        if (
            block.status === "streaming" ||
            block.status === "ready" ||
            block.status === "running"
        ) {
            return "Running";
        }
        return "";
    });

    let isRunning = $derived(
        block.status === "streaming" ||
            block.status === "ready" ||
            block.status === "running",
    );

    let isSessionTool = $derived(
        block.originalToolName === "list_sessions" ||
            block.originalToolName === "inspect_session" ||
            block.originalToolName === "start_session",
    );

    let sessionToolLabel = $derived.by(() => {
        if (block.originalToolName === "list_sessions") return "List sessions";
        if (block.originalToolName === "inspect_session") return "Inspect session";
        if (block.originalToolName === "start_session") return "Start session";
        return "Session";
    });

    let sessionToolDetail = $derived.by(() => {
        if (!isSessionTool) return "";
        if (block.originalToolName === "list_sessions") {
            const page = block.args?.page;
            return typeof page === "number" && page > 1 ? `page ${page}` : "";
        }
        const sessionId = String(block.args?.session_id ?? "");
        return sessionId || (block.toolName !== block.originalToolName ? block.toolName || "" : "");
    });
</script>

{#if block.isDiff}
    <ToolDiffBlock {block} />
{:else}
    <div>
        <button
            class="group flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 transition-colors hover:bg-bg-elevated focus:outline-none"
            onclick={onToggle}
        >
            <div class="flex items-center gap-3 overflow-hidden">
                {#if block.originalToolName === "bash" || block.originalToolName === "execute_command"}
                    <span
                        class="font-mono text-[11px] font-semibold text-text-highlight"
                        >$</span
                    >
                    <span
                        class="max-w-[500px] flex-shrink-0 truncate font-mono text-[11px] text-text-main"
                        >{(block.toolName || "").replace("$ ", "")}</span
                    >
                {:else if block.originalToolName === "read_file" || block.originalToolName === "view_file"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Read file</span
                    >
                    <span
                        class="flex-1 min-w-0 truncate font-mono text-[10px] md:text-[11px] text-text-secondary"
                        >{block.toolName !== block.originalToolName
                            ? block.toolName
                            : ""}</span
                    >
                    {#if readFileRange}
                        <span
                            class="shrink-0 font-mono text-[10px] md:text-[11px] text-text-tertiary opacity-70 whitespace-nowrap"
                            >{readFileRange}</span
                        >
                    {/if}
                {:else if isViewImage}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >View image</span
                    >
                    <span
                        class="flex-1 min-w-0 truncate font-mono text-[10px] md:text-[11px] text-text-secondary"
                        >{block.toolName !== block.originalToolName
                            ? block.toolName
                            : imagePath}</span
                    >
                {:else if block.originalToolName === "search"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Search</span
                    >
                    {#if block.args?.query}
                        <span class="truncate font-mono text-[11px] text-text-secondary">"{block.args.query}"{#if block.args.path} in {block.args.path}{/if}</span>
                    {/if}
                {:else if block.originalToolName === "apply_patch"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Edited</span
                    >
                    {#if block.toolName !== block.originalToolName}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary"
                            >{block.toolName}</span
                        >
                    {/if}
                {:else if block.originalToolName === "write_file" || block.originalToolName === "create_file"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Write file</span
                    >
                    {#if block.toolName !== block.originalToolName}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary"
                            >{block.toolName}</span
                        >
                    {/if}
                {:else if block.originalToolName === "website" || block.originalToolName === "web_search" || block.originalToolName === "web_fetch"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Web</span
                    >
                    {#if block.args?.query || block.args?.url}
                        <span class="truncate font-mono text-[11px] text-text-secondary">{block.args.query || block.args.url}</span>
                    {/if}
                {:else if block.originalToolName === "skill" || block.originalToolName === "load_skill"}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >Skill</span
                    >
                    {#if block.toolName !== block.originalToolName}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary"
                            >{(block.toolName || "").replace(/^Skill\s+/i, "")}</span
                        >
                    {/if}
                {:else if isSessionTool}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >{sessionToolLabel}</span
                    >
                    {#if sessionToolDetail}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary"
                            >{sessionToolDetail}</span
                        >
                    {/if}
                {:else}
                    <span
                        class="flex-shrink-0 font-mono text-[11px] font-semibold text-text-highlight"
                        >{block.originalToolName || block.toolName || "tool"}</span
                    >
                    {#if block.toolName !== block.originalToolName}
                        <span
                            class="ml-1 truncate font-mono text-[11px] text-text-secondary"
                            >{block.toolName}</span
                        >
                    {/if}
                {/if}
            </div>

            <div
                class="ml-4 flex flex-shrink-0 items-center gap-3 text-text-tertiary opacity-80 transition-opacity group-hover:opacity-100"
            >
                {#if statusLabel}
                    <span
                        class="font-mono text-[11px] {block.status === 'error' ||
                        block.status === 'aborted'
                            ? 'text-error'
                            : 'text-text-tertiary'}"
                    >
                        {#if isRunning}
                            <span
                                class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-highlight"
                            ></span>
                        {/if}
                        {statusLabel}
                    </span>
                {/if}
            </div>
        </button>

        {#if expanded}
            <div
                transition:slide={{ duration: 200 }}
                class="mt-1.5 mb-3 overflow-hidden rounded-[6px] border border-border-default bg-bg-code-block"
            >
                <div class="overflow-x-auto bg-bg-code-block p-4">
                    <pre
                        class="text-[12px] font-mono leading-relaxed {block.error
                            ? 'text-error'
                            : 'text-text-warning'}">{expandedPreview}</pre>
                </div>

                {#if block.kind === "tool-call" && block.hasResult}
                    <div
                        class="border-t border-border-default bg-bg-code-block p-4 overflow-x-auto"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <div
                                class="text-[10px] font-bold uppercase tracking-wider text-text-tertiary"
                            >
                                Result
                            </div>
                            {#if block.error}
                                <div
                                    class="rounded-sm border border-error/30 bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error"
                                >
                                    Failed
                                </div>
                            {/if}
                        </div>
                        {#if isViewImage && !block.error}
                            <div class="text-[12px] font-mono leading-relaxed text-text-warning">
                                Image loaded and sent to the model.
                            </div>
                        {:else}
                            <pre
                                class="text-[12px] font-mono leading-relaxed {block.error
                                    ? 'text-error'
                                    : 'text-text-warning'}">{stringifyValue(
                                    block.result,
                                )}</pre>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
