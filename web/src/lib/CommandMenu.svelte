<script lang="ts">
	import { tick } from 'svelte';

	let {
		skills = [],
		currentModel = '',
		currentThinking = '',
		onCommand
	} = $props<{
		skills: Array<{ name: string; description: string }>;
		currentModel: string;
		currentThinking: string;
		onCommand: (command: string, args: string) => void;
	}>();

	let open = $state(false);
	let buttonRef = $state<HTMLButtonElement | null>(null);
	let menuStyle = $state('');

	const MODEL_PRESETS = [
		{ label: 'openai/gpt-5.4', provider: 'openai', model: 'gpt-5.4' },
		{ label: 'openai/gpt-5.4-mini', provider: 'openai', model: 'gpt-5.4-mini' },
		{ label: 'openai/gpt-5.3-codex', provider: 'openai', model: 'gpt-5.3-codex' },
		{ label: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
		{ label: 'google/gemini-2.5-pro', provider: 'google', model: 'gemini-2.5-pro' },
		{ label: 'google/gemini-2.5-flash', provider: 'google', model: 'gemini-2.5-flash' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.6', provider: 'workers_ai', model: '@cf/moonshotai/kimi-k2.6' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.5', provider: 'workers_ai', model: '@cf/moonshotai/kimi-k2.5' }
	];

	const THINKING_PRESETS = ['none', 'low', 'high', 'xhigh'];

	let view: 'main' | 'models' | 'thinking' | 'skills' = $state('main');

	async function toggle() {
		open = !open;
		view = 'main';
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
		menuStyle = `position:fixed;left:${left}px;bottom:${window.innerHeight - rect.top + 8}px;width:${menuWidth}px;z-index:9999;`;
	}

	function execute(command: string, args: string) {
		open = false;
		view = 'main';
		onCommand(command, args);
	}

	function close() {
		open = false;
		view = 'main';
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
	class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] rounded-[6px] transition-colors"
	aria-label="More actions"
	type="button"
>
	<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"></path></svg>
</button>

{#if open}
	<div style={menuStyle} use:clickOutside={close}>
		<div class="bg-[#242426] border border-[#313133] rounded-[12px] shadow-2xl overflow-hidden">
			{#if view === 'main'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'models'} type="button">
						<svg class="w-4 h-4 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-[#cccccc]">Switch Model</span>
							<span class="text-[11px] text-[#858585] truncate" title={currentModel}>{shortenModel(currentModel) || 'None'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'thinking'} type="button">
						<svg class="w-4 h-4 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"></path></svg>
						<div class="flex flex-col min-w-0 flex-1">
							<span class="text-[13px] text-[#cccccc]">Thinking</span>
							<span class="text-[11px] text-[#858585] truncate">{currentThinking || 'default'}</span>
						</div>
						<svg class="w-3.5 h-3.5 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
					</button>

					{#if skills.length > 0}
						<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'skills'} type="button">
							<svg class="w-4 h-4 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
							<span class="text-[13px] text-[#cccccc] flex-1">Load Skill</span>
							<svg class="w-3.5 h-3.5 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
						</button>
					{/if}

					<div class="h-px bg-[#313133] my-1 mx-2"></div>

					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[#2a2d2e] transition-colors" onclick={() => execute('clear', '')} type="button">
						<svg class="w-4 h-4 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
						<span class="text-[13px] text-[#cccccc]">Clear Chat</span>
					</button>

					<button class="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-[#2a2d2e] transition-colors" onclick={() => execute('new', '')} type="button">
						<svg class="w-4 h-4 text-[#858585] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
						<span class="text-[13px] text-[#cccccc]">New Session</span>
					</button>
				</div>
			{:else if view === 'models'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2 flex items-center gap-2 text-[#858585] hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'main'} type="button">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						<span class="text-[12px]">Back</span>
					</button>
					<div class="h-px bg-[#313133] my-1 mx-2"></div>
					{#each MODEL_PRESETS as m (m.label)}
						<button class="w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-[#2a2d2e] transition-colors" onclick={() => execute('model', `${m.provider}/${m.model}`)} type="button">
							<span class="text-[13px] text-[#cccccc] truncate pr-2">{shortenModel(m.label)}</span>
							{#if m.label === currentModel}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#3a4515] text-[#b8dd35] flex-shrink-0">active</span>
							{/if}
						</button>
					{/each}
				</div>
			{:else if view === 'thinking'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2 flex items-center gap-2 text-[#858585] hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'main'} type="button">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						<span class="text-[12px]">Back</span>
					</button>
					<div class="h-px bg-[#313133] my-1 mx-2"></div>
					{#each THINKING_PRESETS as mode (mode)}
						<button class="w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-[#2a2d2e] transition-colors" onclick={() => execute('thinking', mode)} type="button">
							<span class="text-[13px] text-[#cccccc]">{mode}</span>
							{#if mode === currentThinking}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#3a4515] text-[#b8dd35] flex-shrink-0">active</span>
							{/if}
						</button>
					{/each}
				</div>
			{:else if view === 'skills'}
				<div class="py-1">
					<button class="w-full text-left px-3 py-2 flex items-center gap-2 text-[#858585] hover:bg-[#2a2d2e] transition-colors" onclick={() => view = 'main'} type="button">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
						<span class="text-[12px]">Back</span>
					</button>
					<div class="h-px bg-[#313133] my-1 mx-2"></div>
					{#each skills as skill (skill.name)}
						<button class="w-full text-left px-3 py-2.5 hover:bg-[#2a2d2e] transition-colors" onclick={() => execute('skill', skill.name)} type="button">
							<div class="text-[13px] text-[#cccccc]">{skill.name}</div>
							<div class="text-[11px] text-[#858585] truncate">{skill.description}</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
