<script lang="ts">
    let {
        active = true,
        class: className = "",
    } = $props<{
        active?: boolean;
        class?: string;
    }>();
</script>

{#if active}
    <svg
        class="inline-block shrink-0 animate-spin align-text-bottom {className.includes('w-') || className.includes('size-') || className.includes('h-') ? '' : 'w-[1.1em] h-[1.1em]'} {className}"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            stroke-width="2"
            class="opacity-20"
        />
        <path
            d="M14 8C14 4.68629 11.3137 2 8 2"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
        />
    </svg>
{/if}
