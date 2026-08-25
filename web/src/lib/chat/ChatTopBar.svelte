<script lang="ts">
	import BrailleSpinner from '$lib/BrailleSpinner.svelte';

	let {
		sidebarOpen = false,
		onToggleSidebar,
		canShare = false,
		isSharing = false,
		onShare,
	} = $props<{
		sidebarOpen?: boolean;
		onToggleSidebar: () => void;
		canShare?: boolean;
		isSharing?: boolean;
		onShare?: () => void;
	}>();
</script>

<div
	class="absolute top-0 left-0 right-0 z-20 p-3 pointer-events-none select-none md:p-4 flex items-start justify-between"
>
	{#if !sidebarOpen}
		<button
			class="icon-button pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border-default/50 bg-bg-surface/80 text-text-secondary backdrop-blur-xs transition-colors hover:bg-bg-hover hover:text-text-main"
			onclick={onToggleSidebar}
			aria-label="Expand sidebar"
			title="Expand sidebar"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
			</svg>
		</button>
	{/if}

	{#if canShare && onShare}
		<button
			class="icon-button pointer-events-auto ml-auto flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg border border-border-default/50 bg-bg-surface/80 px-0 text-[12px] font-medium text-text-secondary backdrop-blur-xs transition-colors hover:bg-bg-hover hover:text-text-main disabled:opacity-60 sm:w-auto sm:px-2.5"
			onclick={onShare}
			disabled={isSharing}
			aria-label="Share session"
			title="Share session"
		>
			{#if isSharing}
				<BrailleSpinner class="font-mono text-[12px]" />
				<span class="hidden sm:inline">Sharing</span>
			{:else}
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12v6a2 2 0 002 2h12a2 2 0 002-2v-6M16 6l-4-4-4 4M12 2v13" />
				</svg>
				<span class="hidden sm:inline">Share</span>
			{/if}
		</button>
	{/if}
</div>
