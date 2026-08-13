<script lang="ts">
    import Spinner from "$lib/Spinner.svelte";

    let {
        active = true,
        class: className = "",
    } = $props<{
        active?: boolean;
        intervalMs?: number;
        class?: string;
    }>();
</script>

<Spinner {active} class={className} />
