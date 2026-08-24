<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { Command } from 'bits-ui';
	import type { LocalServiceProject } from '$lib/chump/local-service-api';
	import type { ModelChoice } from '$lib/models';
	import { setDocumentTheme } from '$lib/theme';

	let {
		models = [],
		currentModel = '',
		currentThinking = '',
		projects = [],
		activeProjectId = '',
		onCommand,
		onToggleSidebar,
		onOpenConnectModal,
		onSelectProject,
		onOpenProjectRegistration,
		openProjectPickerRequest = 0
	} = $props<{
		models: ModelChoice[];
		currentModel: string;
		currentThinking: string;
		projects?: LocalServiceProject[];
		activeProjectId?: string;
		onCommand: (command: string, args: string) => void | Promise<void>;
		onToggleSidebar: () => void;
		onOpenConnectModal: () => void;
		onSelectProject?: (projectId: string) => void;
		onOpenProjectRegistration?: () => void | Promise<void>;
		openProjectPickerRequest?: number;
	}>();

	let isOpen = $state(false);
	let searchQuery = $state('');
	type PaletteView = 'main' | 'models' | 'reasoning' | 'theme' | 'projects';
	let currentView = $state<PaletteView>('main');
	let handledProjectPickerRequest = $state(0);

	$effect(() => {
		if (openProjectPickerRequest <= handledProjectPickerRequest) return;
		handledProjectPickerRequest = openProjectPickerRequest;
		isOpen = true;
		currentView = 'projects';
		searchQuery = '';
	});

	type ActionItem = {
		id: string;
		label: string;
		description?: string;
		shortcut?: string;
		category: string;
		handler: () => void;
	};

	const mainActions = $derived.by((): ActionItem[] => {
		const actions: ActionItem[] = [
			{
				id: 'new-session',
				label: 'New Session',
				description: 'Start a fresh chat with a clean context',
				shortcut: '⌘N',
				category: 'Session Controls',
				handler: () => {
					void onCommand('new', '');
					isOpen = false;
				}
			},
			{
				id: 'compact-context',
				label: 'Compact Context',
				description: 'Summarize history to optimize context token usage',
				shortcut: '⌥C',
				category: 'Session Controls',
				handler: () => {
					void onCommand('compact', '');
					isOpen = false;
				}
			},
			{
				id: 'clear-chat',
				label: 'Clear Session Messages',
				description: 'Wipe all messages in the current session',
				category: 'Session Controls',
				handler: () => {
					void onCommand('clear', '');
					isOpen = false;
				}
			},
			{
				id: 'change-model',
				label: 'Change AI Model...',
				description: 'Select which model to route this session through',
				shortcut: '⌘M',
				category: 'Settings & Config',
				handler: () => {
					currentView = 'models';
					searchQuery = '';
				}
			},
			{
				id: 'set-reasoning',
				label: 'Set Reasoning Level...',
				description: "Adjust the model's active thinking/reasoning scale",
				shortcut: '⌘T',
				category: 'Settings & Config',
				handler: () => {
					currentView = 'reasoning';
					searchQuery = '';
				}
			},
			...(projects.length > 0
				? [
						{
							id: 'switch-project',
							label: 'Switch Active Project...',
							description: 'Switch to another registered workspace',
							shortcut: '⌘P',
							category: 'Settings & Config',
							handler: () => {
								currentView = 'projects';
								searchQuery = '';
							}
						} satisfies ActionItem
				  ]
				: []),
			{
				id: 'change-theme',
				label: 'Change Theme Mode...',
				description: 'Switch appearance between Light and Dark mode',
				shortcut: '⌘D',
				category: 'Interface',
				handler: () => {
					currentView = 'theme';
					searchQuery = '';
				}
			},
			{
				id: 'toggle-sidebar',
				label: 'Toggle Session Sidebar',
				description: 'Show or hide the list of your past chat sessions',
				shortcut: '⌘B',
				category: 'Interface',
				handler: () => {
					onToggleSidebar();
					isOpen = false;
				}
			},
			{
				id: 'configure-server',
				label: 'Connection Settings...',
				description: 'Set the local service or direct server target',
				category: 'Settings & Config',
				handler: () => {
					onOpenConnectModal();
					isOpen = false;
				}
			}
		];
		return actions;
	});

	const reasoningLevels = [
		{ id: 'none', label: 'None', desc: 'Standard immediate responses' },
		{ id: 'low', label: 'Low', desc: 'Quick reasoning and analysis' },
		{ id: 'high', label: 'High', desc: 'Detailed step-by-step thinking' },
		{ id: 'xhigh', label: 'Extra High', desc: 'Maximum deep thinking level' }
	];

	let filteredItems = $derived.by((): ActionItem[] => {
		const query = searchQuery.toLowerCase().trim();
		if (currentView === 'main') {
			if (!query) return mainActions;
			return mainActions.filter(
				(item) =>
					item.label.toLowerCase().includes(query) ||
					(item.description && item.description.toLowerCase().includes(query))
			);
		} else if (currentView === 'models') {
			const formattedModels: ActionItem[] = models.map((model: ModelChoice) => ({
				id: `${model.provider}/${model.model}`,
				label: `${model.provider}/${model.model}`,
				description: model.label,
				category: model.provider.toUpperCase(),
				handler: () => {
					void onCommand('model', `${model.provider}/${model.model}`);
					isOpen = false;
				}
			}));
			if (!query) return formattedModels;
			return formattedModels.filter(
				(model: ActionItem) =>
					model.label.toLowerCase().includes(query) ||
					(model.description?.toLowerCase().includes(query) ?? false)
			);
		} else if (currentView === 'theme') {
			const themes = [
				{ id: 'light', label: 'Light Mode', description: 'Standard high-contrast light layout' },
				{ id: 'dark', label: 'Dark Mode', description: 'Subtle low-contrast dark layout' }
			];
			const formattedThemes = themes.map((theme) => ({
				id: theme.id,
				label: theme.label,
				description: theme.description,
				category: 'Theme Appearance',
				handler: () => {
					setDocumentTheme(theme.id as 'light' | 'dark');
					isOpen = false;
				}
			}));
			if (!query) return formattedThemes;
			return formattedThemes.filter(
				(theme) =>
					theme.label.toLowerCase().includes(query) ||
					theme.description.toLowerCase().includes(query)
			);
		} else if (currentView === 'projects') {
			const formattedProjects: ActionItem[] = projects.map((project: LocalServiceProject) => ({
				id: project.id,
				label: project.name,
				description: project.workspacePath,
				category: 'Projects',
				handler: () => {
					onSelectProject?.(project.id);
					isOpen = false;
				}
			}));
			if (onOpenProjectRegistration) {
				formattedProjects.push({
					id: 'register-project',
					label: 'Register a new project...',
					description: 'Choose a workspace folder to add',
					category: 'Projects',
					handler: () => {
						void onOpenProjectRegistration();
						isOpen = false;
					}
				});
			}
			if (!query) return formattedProjects;
			return formattedProjects.filter(
				(project: ActionItem) =>
					project.label.toLowerCase().includes(query) ||
					(project.description?.toLowerCase().includes(query) ?? false)
			);
		}

		const formattedReasoning = reasoningLevels.map((level) => ({
			id: level.id,
			label: level.label,
			description: level.desc,
			category: 'Thinking Level',
			handler: () => {
				void onCommand('thinking', level.id);
				isOpen = false;
			}
		}));
		if (!query) return formattedReasoning;
		return formattedReasoning.filter(
			(level) =>
				level.label.toLowerCase().includes(query) ||
				level.description.toLowerCase().includes(query)
		);
	});

	type GroupedAction = {
		category: string;
		items: ActionItem[];
	};
	let groupedFilteredItems = $derived.by((): GroupedAction[] => {
		const groups: Record<string, ActionItem[]> = {};
		for (const item of filteredItems) {
			if (!groups[item.category]) {
				groups[item.category] = [];
			}
			groups[item.category].push(item);
		}
		return Object.entries(groups).map(([category, items]) => ({
			category,
			items
		}));
	});

	function handleGlobalKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			isOpen = !isOpen;
			if (isOpen) {
				currentView = 'main';
				searchQuery = '';
			}
		}
	}

	function handleModalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			if (currentView !== 'main') {
				currentView = 'main';
				searchQuery = '';
			} else {
				isOpen = false;
			}
		} else if (event.key === 'Backspace' && searchQuery === '' && currentView !== 'main') {
			event.preventDefault();
			currentView = 'main';
		}
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		};
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-[99999] flex cursor-default select-none items-start justify-center bg-bg-overlay/35 p-4 pt-[12vh] backdrop-blur-[4px]"
		onclick={() => (isOpen = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			transition:fly={{ y: -16, duration: 250 }}
			class="w-full max-w-lg focus:outline-none"
			onclick={(event) => event.stopPropagation()}
		>
			<Command.Root
				class="flex w-full flex-col overflow-hidden rounded-[12px] border border-border-default bg-bg-surface shadow-2xl selection:bg-bg-select"
				onkeydown={handleModalKeydown}
			>
				<div class="flex items-center gap-3 border-b border-border-default/80 px-4 py-3.5">
					<svg class="h-4 w-4 flex-shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>

					{#if currentView !== 'main'}
						<button
							type="button"
							onclick={() => {
								currentView = 'main';
								searchQuery = '';
							}}
							class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-main"
							aria-label="Back to command menu"
							title="Back"
						>
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
					{/if}

					<Command.Input
						bind:value={searchQuery}
						placeholder={
							currentView === 'main'
								? 'Type a command or search...'
								: currentView === 'models'
									? 'Search models...'
									: currentView === 'theme'
										? 'Search themes...'
										: currentView === 'projects'
											? 'Search projects...'
											: 'Search reasoning levels...'
						}
						class="w-full border-none bg-transparent text-[14px] text-text-main outline-none placeholder:text-text-muted focus:outline-none"
						autofocus
					/>
				</div>

				<Command.List class="flex max-h-[340px] flex-col overflow-y-auto p-1.5 outline-none">
					<Command.Empty class="px-4 py-8 text-center text-[13px] text-text-tertiary">
						No commands found for "{searchQuery}"
					</Command.Empty>

					{#if currentView === 'main' || currentView === 'models' || currentView === 'theme' || currentView === 'projects'}
						{#each groupedFilteredItems as group (group.category)}
							<Command.Group class="flex flex-col">
									<div class="select-none px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
									{group.category}
								</div>
								{#each group.items as item (item.id)}
									<Command.Item
										value={`${item.label} ${item.description ?? ''}`}
										onSelect={() => item.handler()}
										class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-left text-text-secondary outline-none transition-colors hover:bg-bg-hover data-[selected]:bg-bg-select data-[selected]:text-text-main"
									>
										<div class="flex min-w-0 flex-1 flex-col">
											<div class="flex items-center gap-2">
												<span class="text-[13px] font-medium leading-normal">{item.label}</span>
												{#if currentView === 'projects' && item.id === activeProjectId}
														<span class="rounded bg-bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
														Current
													</span>
												{/if}
											</div>
											{#if item.description}
												<span class="mt-0.5 truncate text-[11px] leading-normal text-text-tertiary">{item.description}</span>
											{/if}
										</div>
										{#if item.shortcut}
											<span class="flex-shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-mono text-text-muted select-none">
												{item.shortcut}
											</span>
										{/if}
									</Command.Item>
								{/each}
							</Command.Group>
						{/each}
					{:else if currentView === 'reasoning'}
						<Command.Group class="flex flex-col">
									<div class="select-none px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
								Thinking Level
							</div>
							{#each filteredItems as item (item.id)}
								<Command.Item
									value={item.label}
									onSelect={() => item.handler()}
									class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-left text-text-secondary outline-none transition-colors hover:bg-bg-hover data-[selected]:bg-bg-select data-[selected]:text-text-main"
								>
									<div class="flex min-w-0 flex-col">
										<span class="text-[13px] font-medium leading-normal">{item.label}</span>
										{#if item.description}
											<span class="mt-0.5 truncate text-[11px] leading-normal text-text-tertiary">{item.description}</span>
										{/if}
									</div>
								</Command.Item>
							{/each}
						</Command.Group>
					{/if}
				</Command.List>

				<div class="flex select-none items-center justify-between border-t border-border-default/60 bg-bg-surface-alt px-4 py-2 text-[10px] text-text-tertiary">
					<div class="flex items-center gap-3">
						<span class="flex items-center gap-1"><kbd class="rounded bg-bg-elevated px-1 py-0.5 font-mono">↑↓</kbd> Navigate</span>
						<span class="flex items-center gap-1"><kbd class="rounded bg-bg-elevated px-1.5 py-0.5 font-mono">Enter</kbd> Select</span>
						<span class="flex items-center gap-1"><kbd class="rounded bg-bg-elevated px-1.5 py-0.5 font-mono">Esc</kbd> Close</span>
					</div>
					{#if currentView !== 'main'}
						<span class="flex items-center gap-1"><kbd class="rounded bg-bg-elevated px-1.5 py-0.5 font-mono">Backspace</kbd> Back</span>
					{/if}
				</div>
			</Command.Root>
		</div>
	</div>
{/if}
