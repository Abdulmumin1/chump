<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SettingsSidebar from '$lib/SettingsSidebar.svelte';
	import Toasts from '$lib/Toasts.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	let mobileOpen = $state(false);

	const pathname = $derived(page.url.pathname);
	const tab = $derived(page.url.searchParams.get('tab') ?? '');

	const breadcrumbSection = $derived(
		pathname.includes('/organizations') ? 'Organization' : 'Personal'
	);

	const breadcrumbPage = $derived.by(() => {
		if (pathname.includes('/organizations')) {
			if (tab === 'teams') return 'Teams';
			if (tab === 'members') return 'Members';
			if (tab === 'invitations') return 'Invitations';
			return 'General';
		} else {
			if (tab === 'security') return 'Security & Sessions';
			if (tab === 'connection') return 'Connections';
			return 'Preferences';
		}
	});
</script>

<Toasts />

<div class="min-h-screen bg-bg-body text-text-main flex flex-col md:flex-row">
	<!-- Mobile Top Bar -->
	<header class="md:hidden flex items-center justify-between px-4 py-3 bg-bg-surface-alt border-b border-border-default">
		<button
			type="button"
			class="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-main"
			onclick={() => (mobileOpen = true)}
		>
			<svg class="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
			</svg>
			<span>Settings Menu</span>
		</button>
		<div class="flex items-center gap-2 text-xs text-text-tertiary font-mono">
			<span>{breadcrumbSection}</span>
			<span>/</span>
			<span class="text-text-main">{breadcrumbPage}</span>
		</div>
	</header>

	<!-- Mobile Sidebar Overlay Drawer -->
	{#if mobileOpen}
		<div
			class="md:hidden fixed inset-0 z-50 bg-[var(--bg-overlay)] backdrop-blur-xs flex"
			role="dialog"
			aria-modal="true"
		>
			<div class="relative w-72 max-w-[80vw] h-full bg-bg-surface-alt">
				<SettingsSidebar
					user={data.user}
					bind:mobileOpen
				/>
			</div>
			<button
				type="button"
				class="flex-1 h-full cursor-default"
				onclick={() => (mobileOpen = false)}
				aria-label="Close backdrop"
			></button>
		</div>
	{/if}

	<!-- Desktop Sidebar -->
	<div class="hidden md:block h-screen sticky top-0 shrink-0">
		<SettingsSidebar
			user={data.user}
		/>
	</div>

	<!-- Main Content Area -->
	<main class="flex-1 min-w-0 flex flex-col min-h-screen">
		<!-- Desktop Breadcrumb Top Bar -->
		<header class="hidden md:flex items-center justify-between px-8 py-4 border-b border-border-default bg-bg-body/90 backdrop-blur-xs sticky top-0 z-10">
			<nav class="flex items-center gap-2 text-xs font-mono text-text-tertiary" aria-label="Breadcrumb">
				<span>Settings</span>
				<span>/</span>
				<span>{breadcrumbSection}</span>
				<span>/</span>
				<span class="text-text-inverse font-semibold">{breadcrumbPage}</span>
			</nav>

			<a
				href={resolve('/c')}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default bg-bg-surface text-xs text-text-secondary hover:text-text-inverse hover:border-border-hover transition-colors"
			>
				<span>Return to Chat</span>
				<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
				</svg>
			</a>
		</header>

		<!-- Content View Container -->
		<div class="flex-1 p-4 sm:p-8 lg:p-10 max-w-5xl w-full mx-auto">
			{@render children()}
		</div>
	</main>
</div>
