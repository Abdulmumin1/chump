<script lang="ts">
    let {
        active = true,
        duration = "1.2s",
        class: className = "",
    } = $props<{
        active?: boolean;
        duration?: string;
        class?: string;
    }>();
</script>

{#if active}
    <span
        role="status"
        class="inline-block rounded-full animate-pulse-dot {className.includes(
            'w-',
        ) ||
        className.includes('size-') ||
        className.includes('h-')
            ? ''
            : 'w-2 h-2'} {className} bg-current"
        style="--duration: {duration};"
        aria-label="Loading"
    >
        <span class="sr-only">Loading</span>
    </span>
{/if}
