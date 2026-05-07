<script lang="ts">
	import { tick } from 'svelte';

	let {
		composerText = $bindable(),
		activeSessionId,
		canSteer,
		canSend,
		isSending,
		skills = [],
		currentModel = '',
		workspaceRoot = '',
		onSend,
		onSteer,
		onCommand
	} = $props<{
		composerText: string;
		activeSessionId: string;
		canSteer: boolean;
		canSend: boolean;
		isSending: boolean;
		skills: Array<{ name: string; description: string }>;
		currentModel: string;
		workspaceRoot: string;
		onSend: () => void;
		onSteer: () => void;
		onCommand: (command: string, args: string) => void | Promise<void>;
	}>();

	let textareaElement = $state<HTMLTextAreaElement | null>(null);
	let selectedIndex = $state(0);
	let menuOpen = $state(false);

	type Suggestion = {
		label: string;
		command: string;
		description: string;
		kind: 'root' | 'model' | 'skill' | 'command';
	};

	const ROOT_COMMANDS: Suggestion[] = [
		{ label: '/model', command: '/model ', description: 'choose provider and model', kind: 'root' },
		{ label: '/skill', command: '/skill:', description: 'load a skill manually', kind: 'root' },
		{ label: '/clear', command: '/clear', description: 'clear messages for current session', kind: 'command' },
		{ label: '/new', command: '/new', description: 'start a fresh session', kind: 'command' }
	];

	const MODEL_PRESETS: Suggestion[] = [
		{ label: 'openai/gpt-5.4', command: '/model openai/gpt-5.4', description: 'OpenAI GPT-5.4', kind: 'model' },
		{ label: 'openai/gpt-5.4-mini', command: '/model openai/gpt-5.4-mini', description: 'OpenAI GPT-5.4 Mini', kind: 'model' },
		{ label: 'openai/gpt-5.3-codex', command: '/model openai/gpt-5.3-codex', description: 'OpenAI GPT-5.3 Codex', kind: 'model' },
		{ label: 'openai/gpt-5.2', command: '/model openai/gpt-5.2', description: 'OpenAI GPT-5.2', kind: 'model' },
		{ label: 'anthropic/claude-sonnet-4-20250514', command: '/model anthropic/claude-sonnet-4-20250514', description: 'Claude Sonnet 4', kind: 'model' },
		{ label: 'google/gemini-2.5-pro', command: '/model google/gemini-2.5-pro', description: 'Gemini 2.5 Pro', kind: 'model' },
		{ label: 'google/gemini-2.5-flash', command: '/model google/gemini-2.5-flash', description: 'Gemini 2.5 Flash', kind: 'model' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.6', command: '/model workers_ai/@cf/moonshotai/kimi-k2.6', description: 'Kimi K2.6', kind: 'model' },
		{ label: 'workers_ai/@cf/moonshotai/kimi-k2.5', command: '/model workers_ai/@cf/moonshotai/kimi-k2.5', description: 'Kimi K2.5', kind: 'model' }
	];

	let suggestions = $derived.by(() => {
		const text = composerText;
		if (!text.startsWith('/')) return [];

		const trimmed = text.trim();

		// Skill completion: /skill:name or /skill name
		if (trimmed.startsWith('/skill:') || /^\/skill\s/.test(trimmed)) {
			const query = trimmed.startsWith('/skill:')
				? trimmed.slice('/skill:'.length).trim().toLowerCase()
				: trimmed.slice('/skill'.length).trim().toLowerCase();
			return skills
				.filter((s: { name: string; description: string }) => !query || s.name.toLowerCase().includes(query))
				.map((s: { name: string; description: string }) => ({
					label: s.name,
					command: `/skill:${s.name}`,
					description: s.description,
					kind: 'skill' as const
				}));
		}

		// Model completion: /model query
		if (/^\/model(?:\s|$)/.test(trimmed)) {
			const query = trimmed.slice('/model'.length).trim().toLowerCase();
			return MODEL_PRESETS.filter((m) =>
				!query || m.label.toLowerCase().includes(query) || m.description.toLowerCase().includes(query)
			);
		}

		// Root command completion
		const hits = ROOT_COMMANDS.filter((c) => c.label.startsWith(trimmed));
		return hits.length > 0 ? hits : trimmed === '/' ? ROOT_COMMANDS : [];
	});

	let visible = $derived(suggestions.length > 0 && menuOpen);

	function handleKeydown(event: KeyboardEvent) {
		if (!visible) {
			// Check if this is starting a slash command
			if (event.key === '/' && !composerText) {
				menuOpen = true;
				selectedIndex = 0;
			}
			// Let the parent handle normal send keys
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				onSend();
				return;
			}
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedIndex = (selectedIndex + 1) % suggestions.length;
				scrollSelectedIntoView();
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
				scrollSelectedIntoView();
				break;
			case 'Enter':
				event.preventDefault();
				acceptSuggestion(suggestions[selectedIndex]);
				break;
			case 'Escape':
				event.preventDefault();
				menuOpen = false;
				break;
			case 'Tab':
				event.preventDefault();
				if (suggestions.length === 1) {
					acceptSuggestion(suggestions[0]);
				} else {
					selectedIndex = (selectedIndex + 1) % suggestions.length;
					scrollSelectedIntoView();
				}
				break;
		}
	}

	function acceptSuggestion(suggestion: Suggestion | undefined) {
		if (!suggestion) return;

		if (suggestion.kind === 'root' && suggestion.command.endsWith(' ')) {
			// Keep menu open for next level (model/skill selection)
			composerText = suggestion.command;
			selectedIndex = 0;
			void tick().then(() => {
				textareaElement?.focus();
			});
			return;
		}

		// Execute the command
		menuOpen = false;
		composerText = '';
		void tick().then(() => {
			textareaElement?.focus();
		});

		// Parse the command
		const trimmed = suggestion.command.trim();
		if (trimmed === '/clear') {
			void onCommand('clear', '');
			return;
		}
		if (trimmed === '/new') {
			void onCommand('new', '');
			return;
		}
		if (trimmed.startsWith('/model ')) {
			const modelSpec = trimmed.slice('/model '.length).trim();
			void onCommand('model', modelSpec);
			return;
		}
		if (trimmed.startsWith('/skill:')) {
			const skillName = trimmed.slice('/skill:'.length).trim();
			void onCommand('skill', skillName);
			return;
		}
	}

	function scrollSelectedIntoView() {
		void tick().then(() => {
			const el = document.querySelector('[data-suggestion-selected="true"]');
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function handleInput() {
		if (!composerText.startsWith('/')) {
			menuOpen = false;
			return;
		}
		menuOpen = true;
		selectedIndex = 0;
	}

	let isCommand = $derived(composerText.trim().startsWith('/'));
</script>

<div class="w-full px-2 md:px-8 pb-4 md:pb-6 pt-2 bg-[#1c1c1e] relative">
	<div class="max-w-5xl mx-auto bg-[#242426] border border-[#313133] rounded-[8px] flex flex-col focus-within:border-[#4d4d4d] transition-colors shadow-lg relative z-10">
		<textarea
			bind:this={textareaElement}
			bind:value={composerText}
			rows="2"
			placeholder="Message the agent..."
			onkeydown={handleKeydown}
			oninput={handleInput}
			class="w-full bg-transparent border-none rounded-t-[8px] px-3 md:px-4 py-2.5 md:py-3 text-[14px] text-[#cccccc] focus:outline-none resize-none min-h-[52px] md:min-h-[60px] max-h-[200px] md:max-h-[300px] placeholder:text-[#6a6a6a]"
		></textarea>

		<div class="flex justify-between items-center px-2 md:px-3 py-1.5 md:py-2 border-t border-[#313133] rounded-b-[8px]">
			<div class="flex items-center gap-2">
				{#if activeSessionId && composerText.trim() && !isCommand}
					<button class="px-2 md:px-3 py-1 text-[11px] md:text-[12px] bg-[#333333] hover:bg-[#404040] text-[#cccccc] rounded-[4px] transition-colors disabled:opacity-50" onclick={onSteer} disabled={!canSteer}>Steer</button>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[11px] md:text-[12px] font-medium text-[#6a6a6a] mr-1 md:mr-2 tracking-wide hidden sm:inline">⌘ Enter</span>
				<button aria-label="Send message" class="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-[#2b2b2b] text-[#858585] hover:bg-[#3b3b3b] hover:text-[#cccccc] rounded-[6px] transition-colors disabled:opacity-50" onclick={onSend} disabled={!canSend || isSending || isCommand}>
					<svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
				</button>
			</div>
		</div>
	</div>

	<div class="max-w-5xl mx-auto flex items-center justify-between mt-1 md:mt-1.5 px-1">
		<div class="flex items-center gap-1.5 text-[10px] md:text-[11px] font-mono text-[#6a6a6a] truncate max-w-[70%]">
			<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
			<span class="truncate">{workspaceRoot || '—'}</span>
		</div>
		{#if currentModel}
			<div class="text-[10px] md:text-[11px] font-mono text-[#6a6a6a] truncate max-w-[30%]">{currentModel}</div>
		{/if}
	</div>

	{#if visible}
		<div class="absolute left-4 right-4 md:left-8 md:right-8 bottom-full mb-1 max-w-5xl mx-auto">
			<div class="bg-[#242426] border border-[#313133] rounded-[8px] shadow-xl overflow-hidden max-h-[280px] overflow-y-auto">
				{#each suggestions as suggestion, index (suggestion.command)}
					<button
						class="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors {index === selectedIndex ? 'bg-[#2a2d2e]' : 'hover:bg-[#2a2d2e]/50'}"
						onclick={() => acceptSuggestion(suggestion)}
						data-suggestion-selected={index === selectedIndex}
						type="button"
					>
						<span class="text-[13px] font-mono text-[#569cd6] min-w-[140px]">{suggestion.label}</span>
						<span class="text-[12px] text-[#858585]">{suggestion.description}</span>
						{#if suggestion.kind === 'model' && suggestion.label === currentModel}
							<span class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[#264f78] text-white">active</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
