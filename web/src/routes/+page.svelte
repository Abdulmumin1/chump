<script lang="ts">
	import Chat from '$lib/Chat.svelte';
	let { data } = $props();

	// Force dark mode globally to match the design
	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.classList.add('dark');
		}
	});
</script>

<div class="flex flex-col min-h-[100dvh] bg-[#0a0a0a] text-zinc-300 transition-colors selection:bg-zinc-800 selection:text-zinc-100">
	<Chat {data} />
</div>