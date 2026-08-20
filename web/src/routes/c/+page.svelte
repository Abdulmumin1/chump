<script lang="ts">
	import Chat from '$lib/Chat.svelte';
	let { data } = $props();
</script>

<div class="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-bg-body text-text-tertiary transition-colors selection:bg-bg-elevated selection:text-text-secondary">
	<Chat {data} />
</div>
