<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let {
		user,
		mobileOpen = $bindable(false)
	}: {
		user: { name: string; email: string; image?: string | null };
		mobileOpen?: boolean;
	} = $props();

	let searchQuery = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);

	const pathname = $derived(page.url.pathname);
	const currentTab = $derived(page.url.searchParams.get('tab') ?? '');

	type ValidRoute = '/account' | '/organizations';

	type NavItem = {
		id: string;
		label: string;
		path: ValidRoute;
		tab?: string;
		keywords: string[];
		icon: 'user' | 'security' | 'server' | 'building' | 'teams' | 'members' | 'mail';
	};

	const personalItems: NavItem[] = [
		{
			id: 'profile',
			label: 'Preferences',
			path: '/account',
			tab: 'profile',
			keywords: ['profile', 'account', 'name', 'email', 'avatar', 'display name', 'personal', 'preferences'],
			icon: 'user'
		},
		{
			id: 'security',
			label: 'Security & Sessions',
			path: '/account',
			tab: 'security',
			keywords: ['security', 'password', 'sessions', 'github', 'login', 'authentication', 'delete account'],
			icon: 'security'
		},
		{
			id: 'connection',
			label: 'Connections',
			path: '/account',
			tab: 'connection',
			keywords: ['daemon', 'host', 'server', 'url', 'token', 'connect', 'connection', 'runtime', 'chump server'],
			icon: 'server'
		}
	];

	const orgItems: NavItem[] = [
		{
			id: 'overview',
			label: 'General',
			path: '/organizations',
			tab: 'overview',
			keywords: ['general', 'overview', 'organization', 'slug', 'switch', 'workspace', 'active org', 'create org', 'name'],
			icon: 'building'
		},
		{
			id: 'teams',
			label: 'Teams',
			path: '/organizations',
			tab: 'teams',
			keywords: ['teams', 'groups', 'add team', 'team members', 'delete team'],
			icon: 'teams'
		},
		{
			id: 'members',
			label: 'Members',
			path: '/organizations',
			tab: 'members',
			keywords: ['members', 'roles', 'admin', 'owner', 'permissions', 'remove member'],
			icon: 'members'
		},
		{
			id: 'invitations',
			label: 'Invitations',
			path: '/organizations',
			tab: 'invitations',
			keywords: ['invitations', 'invite', 'link', 'pending invites', 'email'],
			icon: 'mail'
		}
	];

	function isItemActive(item: NavItem): boolean {
		if (pathname !== resolve(item.path)) return false;
		if (!item.tab) return true;
		if (!currentTab) {
			return item.id === 'profile' || item.id === 'overview';
		}
		return currentTab === item.tab;
	}

	function matchesQuery(item: NavItem, query: string): boolean {
		if (!query.trim()) return true;
		const q = query.toLowerCase().trim();
		return (
			item.label.toLowerCase().includes(q) ||
			item.keywords.some((kw) => kw.includes(q))
		);
	}

	let filteredPersonal = $derived(
		personalItems.filter((item) => matchesQuery(item, searchQuery))
	);

	let filteredOrg = $derived(
		orgItems.filter((item) => matchesQuery(item, searchQuery))
	);

	onMount(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (
				e.key === '/' &&
				document.activeElement?.tagName !== 'INPUT' &&
				document.activeElement?.tagName !== 'TEXTAREA' &&
				document.activeElement?.tagName !== 'SELECT'
			) {
				e.preventDefault();
				searchInput?.focus();
			} else if (e.key === 'Escape' && document.activeElement === searchInput) {
				searchQuery = '';
				searchInput?.blur();
			}
		}

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	function closeMobile() {
		mobileOpen = false;
	}
</script>

<aside class="flex flex-col h-full bg-bg-surface-alt border-r border-border-default w-64 lg:w-72 shrink-0 select-none">
	<!-- Top App Header -->
	<div class="p-4 pb-3 border-b border-border-default flex items-center justify-between">
		<a
			href={resolve('/c')}
			class="group inline-flex items-center gap-2 text-xs font-mono tracking-wider uppercase text-text-tertiary hover:text-text-main transition-colors"
		>
			<svg class="w-3.5 h-3.5 text-text-tertiary group-hover:-translate-x-0.5 group-hover:text-text-main transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
			</svg>
			Back to Chump
		</a>
		{#if mobileOpen}
			<button
				type="button"
				class="md:hidden text-text-tertiary hover:text-text-main p-1"
				onclick={closeMobile}
				aria-label="Close menu"
			>
				<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>

	<!-- Search Input -->
	<div class="px-3 pt-3 pb-2">
		<div class="relative">
			<svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				bind:this={searchInput}
				bind:value={searchQuery}
				type="search"
				placeholder="Search settings..."
				class="w-full bg-bg-input border border-border-default focus:border-accent text-xs rounded-lg pl-8 pr-7 py-1.5 text-text-main placeholder:text-text-tertiary outline-none transition-colors"
			/>
			{#if !searchQuery}
				<kbd class="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] font-mono text-text-tertiary bg-bg-surface border border-border-default rounded px-1 py-0.2">
					/
				</kbd>
			{:else}
				<button
					type="button"
					class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-main text-xs"
					onclick={() => (searchQuery = '')}
				>
					×
				</button>
			{/if}
		</div>
	</div>

	<!-- Navigation Items Container -->
	<div class="flex-1 overflow-y-auto px-2 py-2 space-y-5 scrollbar-thin">
		<!-- Personal Section -->
		{#if filteredPersonal.length > 0}
			<div>
				<div class="px-2 pb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-text-tertiary">
					Personal
				</div>
				<nav class="space-y-0.5">
					{#each filteredPersonal as item (item.id)}
						{@const active = isItemActive(item)}
						<a
							href={resolve(item.path) + (item.tab ? '?tab=' + item.tab : '')}
							onclick={closeMobile}
							class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors {active ? 'bg-bg-hover text-text-inverse font-semibold' : 'text-text-secondary hover:bg-bg-hover hover:text-text-main'}"
						>
							{#if item.icon === 'user'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
								</svg>
							{:else if item.icon === 'security'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
								</svg>
							{:else if item.icon === 'server'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
								</svg>
							{/if}
							<span class="truncate">{item.label}</span>
						</a>
					{/each}
				</nav>
			</div>
		{/if}

		<!-- Organization Section -->
		{#if filteredOrg.length > 0}
			<div>
				<div class="px-2 pb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-text-tertiary">
					Organization
				</div>

				<nav class="space-y-0.5">
					{#each filteredOrg as item (item.id)}
						{@const active = isItemActive(item)}
						<a
							href={resolve(item.path) + (item.tab ? '?tab=' + item.tab : '')}
							onclick={closeMobile}
							class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors {active ? 'bg-bg-hover text-text-inverse font-semibold' : 'text-text-secondary hover:bg-bg-hover hover:text-text-main'}"
						>
							{#if item.icon === 'building'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V11m0 0V7m0 4h4M7 7h10" />
								</svg>
							{:else if item.icon === 'teams'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
								</svg>
							{:else if item.icon === 'members'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
								</svg>
							{:else if item.icon === 'mail'}
								<svg class="w-3.5 h-3.5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
								</svg>
							{/if}
							<span class="truncate">{item.label}</span>
						</a>
					{/each}
				</nav>
			</div>
		{/if}

		{#if filteredPersonal.length === 0 && filteredOrg.length === 0}
			<div class="px-3 py-6 text-center text-xs text-text-tertiary">
				No settings match "{searchQuery}"
			</div>
		{/if}
	</div>

	<!-- Bottom User Footer -->
	<div class="p-3 border-t border-border-default bg-bg-surface flex items-center gap-2.5">
		{#if user.image}
			<img src={user.image} alt={user.name} class="size-7 rounded-full object-cover shrink-0 border border-border-default" />
		{:else}
			<div class="grid size-7 shrink-0 place-items-center rounded-full bg-bg-input text-xs font-semibold text-text-inverse border border-border-default">
				{user.name.slice(0, 2).toUpperCase()}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<strong class="block truncate text-xs font-medium text-text-main leading-tight">{user.name}</strong>
			<span class="block truncate text-[10px] text-text-tertiary">{user.email}</span>
		</div>
	</div>
</aside>
