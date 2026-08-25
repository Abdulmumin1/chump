<script lang="ts">
	import TranscriptPane from '$lib/TranscriptPane.svelte';
	import { reasoningSummary } from '$lib/chat/transcript';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let transcriptElement = $state<HTMLDivElement | null>(null);
	let expandedBlocks = $state<Record<string, boolean>>({});
	let expandedReasoning = $state<Record<string, boolean>>({});
	let copied = $state(false);

	function toggleBlock(id: string) {
		expandedBlocks[id] = !expandedBlocks[id];
	}

	function toggleReasoning(id: string, defaultExpanded = false) {
		expandedReasoning[id] = !(expandedReasoning[id] ?? defaultExpanded);
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	const createdAt = $derived(
		data.createdAt ? new Date(data.createdAt).toLocaleString() : ''
	);
</script>

<svelte:head>
	<title>{data.title} · Chump</title>
</svelte:head>

<div class="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-bg-surface text-text-tertiary transition-colors selection:bg-bg-elevated selection:text-text-secondary">
	<header
		class="relative z-20 flex items-center gap-3 border-b border-border-default/40 bg-bg-surface/70 px-4 py-2.5 backdrop-blur-md shrink-0"
	>
		<img src="/favicon.svg" alt="Chump" class="h-5 w-5 select-none" />
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-[13px] font-medium text-text-main">{data.title}</h1>
			<p class="truncate text-[11px] text-text-tertiary">
				{#if createdAt}Shared {createdAt}{:else}Shared session{/if}
			</p>
		</div>
		<button
			type="button"
			class="icon-button flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-text-secondary hover:text-text-main"
			onclick={copyLink}
			title="Copy link"
		>
			{#if copied}
				<svg class="h-4 w-4 text-text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				Copied
			{:else}
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l4-4a4 4 0 015.656 5.656l-1.5 1.5" />
				</svg>
				Copy link
			{/if}
		</button>
	</header>

	{#if data.transcript.length > 0}
		<TranscriptPane
			transcript={data.transcript}
			bind:transcriptElement
			isSending={false}
			{expandedBlocks}
			{expandedReasoning}
			onToggleBlock={toggleBlock}
			onToggleReasoning={toggleReasoning}
			{reasoningSummary}
		/>
	{:else}
		<div class="flex flex-1 items-center justify-center px-4 text-center">
			<p class="text-[14px] text-text-tertiary">This shared session is empty.</p>
		</div>
	{/if}
</div>
