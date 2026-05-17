<script lang="ts">
	import Chat from '$lib/Chat.svelte';
	let { data } = $props();
</script>

<div class="flex flex-col min-h-[100dvh] bg-bg-body text-text-tertiary transition-colors selection:bg-bg-elevated selection:text-text-secondary">
	<Chat {data} />
</div>