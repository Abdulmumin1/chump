<script lang="ts">
	import { tick } from 'svelte';

	import type { ModelChoice } from "$lib/models";

	let {
		models = [],
		currentModel = '',
		currentThinking = '',
		onCommand
	} = $props<{
		models: ModelChoice[];
		currentModel: string;
		currentThinking: string;
		onCommand: (command: string, args: string) => void;
	}>();

	let open = $state(false);
	let buttonRef = $state<HTMLButtonElement | null>(null);
	let modelSearchInput = $state<HTMLInputElement | null>(null);
	let menuStyle = $state('');
	let searchQuery = $state('');

	const THINKING_PRESETS = ['none', 'low', 'high', 'xhigh'];

	let view: 'main' | 'models' | 'thinking' = $state('main');

	let filteredModels = $derived(
		models.filter((m: ModelChoice) => 
			m.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
			m.description.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	async function toggle() {
		open = !open;
		view = 'main';
		searchQuery = '';
		if (open) {
			await tick();
			positionMenu();
		}
	}

	function positionMenu() {
		if (!buttonRef) return;
		const rect = buttonRef.getBoundingClientRect();
		const menuWidth = 280;
		let left = rect.left;
		// Keep menu inside viewport
		if (left + menuWidth > window.innerWidth - 8) {
			left = window.innerWidth - menuWidth - 8;
		}
		if (left < 8) {
			left = 8;
		}
		menuStyle = `position:fixed;left:${left}px;bottom:${window.innerHeight - rect.bottom}px;width:${menuWidth}px;z-index:9999;`;
	}

	function execute(command: string, args: string) {
		open = false;
		view = 'main';
		searchQuery = '';
		onCommand(command, args);
	}

	function close() {
		open = false;
		view = 'main';
		searchQuery = '';
	}

	function clickOutside(node: HTMLElement, handler: () => void) {
		const onClick = (e: MouseEvent) => {
			if (node && !node.contains(e.target as Node) && !buttonRef?.contains(e.target as Node)) {
				handler();
			}
		};
		document.addEventListener('click', onClick, true);
		return {
			destroy() {
				document.removeEventListener('click', onClick, true);
			}
		};
	}

	function shortenModel(name: string): string {
		return name.replace(/^workers_ai\/@cf\//, '');
	}

	async function openModelsView() {
		view = 'models';
		searchQuery = '';
		await tick();
		modelSearchInput?.focus();
	}
</script>

<button
	bind:this={buttonRef}
	onclick={(e) => { e.stopPropagation(); void toggle(); }}
	class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated rounded-[6px] transition-colors"
	aria-label="More actions"
	type="button"
>
	<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"></path></svg>
</button>

{#if open}
	<div style={menuStyle} use:clickOutside={close}>
		<div class="overflow-hidden rounded-[10px] border border-border-default bg-bg-code">
			{#if view === 'main'}
				<div class="py-1">
					<button class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-elevated" onclick={() => void openModelsView()} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-text-secondary">Switch Model</span>
							<span class="text-[11px] text-text-tertiary truncate" title={currentModel}>{shortenModel(currentModel) || 'None'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					<button class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-elevated" onclick={() => view = 'thinking'} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-text-secondary">Thinking</span>
							<span class="text-[11px] text-text-tertiary truncate">{currentThinking || 'default'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					<div class="h-px bg-border-default my-1 mx-2"></div>

					<button class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-elevated" onclick={() => execute('new', '')} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
						<span class="text-[13px] text-text-secondary">New Session</span>
					</button>
				</div>
			{:else if view === 'models'}
				<div class="py-1">
					<div class="px-3 py-2 flex items-center gap-2 border-b border-border-default">
						<button class="button-tertiary flex-shrink-0 px-1.5 py-1 text-text-tertiary" onclick={() => view = 'main'} type="button" aria-label="Back to main menu">
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						</button>
						<input
							bind:this={modelSearchInput}
							type="text"
							bind:value={searchQuery}
							placeholder="Search models..."
							class="w-full bg-transparent border-none text-[13px] text-text-secondary placeholder:text-text-tertiary focus:outline-none"
							autocomplete="off"
						/>
					</div>
					<div class="max-h-[200px] overflow-y-auto mt-1">
						{#each filteredModels as m (m.label)}
							<button class="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-bg-elevated" onclick={() => execute('model', `${m.provider}/${m.model}`)} type="button">
								<div class="flex flex-col min-w-0 pr-2">
									<span class="text-[13px] text-text-secondary truncate">{shortenModel(m.label)}</span>
									{#if m.description}
										<span class="text-[11px] text-text-tertiary truncate">{m.description}</span>
									{/if}
								</div>
								{#if m.label === currentModel}
									<span class="flex-shrink-0 rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] text-text-highlight">active</span>
								{/if}
							</button>
						{:else}
							<div class="px-3 py-3 text-[12px] text-text-tertiary text-center">No models found</div>
						{/each}
					</div>
				</div>
			{:else if view === 'thinking'}
				<div class="py-1">
					<button class="flex w-full items-center gap-2 px-3 py-2 text-left text-text-tertiary transition-colors hover:bg-bg-elevated" onclick={() => view = 'main'} type="button">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						<span class="text-[12px]">Back</span>
					</button>
					<div class="h-px bg-border-default my-1 mx-2"></div>
					{#each THINKING_PRESETS as mode (mode)}
						<button class="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-bg-elevated" onclick={() => execute('thinking', mode)} type="button">
							<span class="text-[13px] text-text-secondary">{mode}</span>
							{#if mode === currentThinking}
								<span class="flex-shrink-0 rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] text-text-highlight">active</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
