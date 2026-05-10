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
		<div class="bg-bg-code border border-border-default rounded-[12px] overflow-hidden">
			{#if view === 'main'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-bg-elevated transition-colors" onclick={() => view = 'models'} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-text-secondary">Switch Model</span>
							<span class="text-[11px] text-text-tertiary truncate" title={currentModel}>{shortenModel(currentModel) || 'None'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-bg-elevated transition-colors" onclick={() => view = 'thinking'} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-text-secondary">Thinking</span>
							<span class="text-[11px] text-text-tertiary truncate">{currentThinking || 'default'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					<div class="h-px bg-border-default my-1 mx-2"></div>

					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-bg-elevated transition-colors" onclick={() => execute('new', '')} type="button">
						<svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
						<span class="text-[13px] text-text-secondary">New Session</span>
					</button>
				</div>
			{:else if view === 'models'}
				<div class="py-1">
					<div class="px-3 py-2 flex items-center gap-2 border-b border-border-default">
						<button class="text-text-tertiary hover:bg-bg-elevated rounded p-1 transition-colors flex-shrink-0" onclick={() => view = 'main'} type="button">
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						</button>
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search models..."
							class="w-full bg-transparent border-none text-[13px] text-text-secondary placeholder:text-text-tertiary focus:outline-none"
							autocomplete="off"
							autofocus
						/>
					</div>
					<div class="max-h-[200px] overflow-y-auto mt-1">
						{#each filteredModels as m (m.label)}
							<button class="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-bg-elevated transition-colors" onclick={() => execute('model', `${m.provider}/${m.model}`)} type="button">
								<div class="flex flex-col min-w-0 pr-2">
									<span class="text-[13px] text-text-secondary truncate">{shortenModel(m.label)}</span>
									{#if m.description}
										<span class="text-[11px] text-text-tertiary truncate">{m.description}</span>
									{/if}
								</div>
								{#if m.label === currentModel}
									<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent flex-shrink-0">active</span>
								{/if}
							</button>
						{:else}
							<div class="px-3 py-3 text-[12px] text-text-tertiary text-center">No models found</div>
						{/each}
					</div>
				</div>
			{:else if view === 'thinking'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2 flex items-center gap-2 text-text-tertiary hover:bg-bg-elevated transition-colors" onclick={() => view = 'main'} type="button">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						<span class="text-[12px]">Back</span>
					</button>
					<div class="h-px bg-border-default my-1 mx-2"></div>
					{#each THINKING_PRESETS as mode (mode)}
						<button class="w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-bg-elevated transition-colors" onclick={() => execute('thinking', mode)} type="button">
							<span class="text-[13px] text-text-secondary">{mode}</span>
							{#if mode === currentThinking}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent flex-shrink-0">active</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
