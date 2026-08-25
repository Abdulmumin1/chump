<script lang="ts">
    import type { DelegatedSessionActivity } from "$lib/chump/types";

    let { activities, onSelectSession } = $props<{
        activities: DelegatedSessionActivity[];
        onSelectSession?: (sessionId: string) => void;
    }>();

    function toolStatusLabel(
        status: "running" | "completed" | "error",
    ): string {
        if (status === "completed") return "Finished";
        if (status === "error") return "Failed";
        return "Using";
    }
</script>

<div
    class="flex w-full mx-auto max-w-[calc(100%-1rem)] items-stretch gap-2 overflow-x-auto"
    aria-live="polite"
    data-testid="delegated-activity-peek"
>
    {#each activities as activity (`${activity.parentCallId}:${activity.parentStep}:${activity.parentIndex}`)}
        <button
            type="button"
            class="flex w-full max-w-[92%] shrink-0 items-start gap-2 mx-auto border-t border-border-default bg-bg-muted rounded-t-lg transition-all duration-300 px-2.5 py-2 text-left text-[12px] shadow-sm hover:border-border-hover hover:bg-bg-elevated"
            aria-label={`Open delegated session ${activity.sessionId}`}
            title={`Open ${activity.sessionId}`}
            onclick={() => onSelectSession?.(activity.sessionId)}
        >
            <span class="min-w-0">
                <span
                    class="shimmer-text flex min-w-0 items-center gap-1.5 text-[11px] leading-4"
                >
                    <span class="shrink-0 font-medium">Sub-agent</span>
                    <span class="shrink-0">·</span>
                    <span class="truncate font-mono">{activity.sessionId}</span>
                </span>

                {#if activity.latestDetail?.kind === "reasoning"}
                    <span
                        class="mt-0.5 block truncate leading-[1.35] text-text-main"
                    >
                        <span class="text-text-tertiary">Thinking ·</span>
                        {activity.latestDetail.text}
                    </span>
                {:else if activity.latestDetail?.kind === "tool"}
                    <span
                        class="mt-0.5 flex min-w-0 items-baseline gap-1.5 leading-[1.35]"
                    >
                        <span
                            class={activity.latestDetail.status === "error"
                                ? "shrink-0 text-text-error"
                                : "shrink-0 text-text-tertiary"}
                        >
                            {toolStatusLabel(activity.latestDetail.status)}
                        </span>
                        <span class="shrink-0 font-mono text-text-main"
                            >{activity.latestDetail.name}</span
                        >
                        {#if activity.latestDetail.detail}
                            <span
                                class="min-w-0 truncate font-mono text-[11px] leading-4 text-text-tertiary"
                            >
                                · {activity.latestDetail.detail}
                            </span>
                        {/if}
                    </span>
                {:else}
                    <span
                        class="mt-0.5 block truncate leading-[1.35] text-text-main"
                    >
                        {activity.phase}
                    </span>
                {/if}
            </span>
        </button>
    {/each}
</div>
