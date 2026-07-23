<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { Account, Session } from 'better-auth';
	import { authClient } from '$lib/auth-client';
	import { getHealth, normalizeServerUrl } from '$lib/chump/api';
	import { listDaemonProjects, normalizeDaemonConnection } from '$lib/chump/daemon-api';
	import { consumeDaemonHandoff } from '$lib/chump/daemon-handoff';
	import {
		forgetDaemonConnection,
		readDaemonConnection,
		rememberDaemonConnection
	} from '$lib/chump/daemon-connection-store';
	import {
		getLoopbackPermissionState,
		loopbackPermissionMessage
	} from '$lib/chump/loopback-permission';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let name = $state('');
	let image = $state('');
	let currentPassword = $state('');
	let newPassword = $state('');
	let deletePassword = $state('');
	let deleteConfirmation = $state('');
	let accounts = $state<Account[]>([]);
	let sessions = $state<Session[]>([]);
	let loading = $state(true);
	let pendingAction = $state('');
	let notice = $state('');
	let errorMessage = $state('');
	let daemonUrl = $state('');
	let daemonToken = $state('');
	let directServerUrl = $state('');
	let testingConnection = $state(false);
	let connectionError = $state('');

	const currentTab = $derived(page.url.searchParams.get('tab') ?? 'profile');

	let hasPassword = $derived(accounts.some((account) => account.providerId === 'credential'));
	let hasGitHub = $derived(accounts.some((account) => account.providerId === 'github'));

	onMount(() => {
		name = data.user.name;
		image = data.user.image ?? '';
		const handoff = consumeDaemonHandoff(window.location.href, sessionStorage, (url) => {
			window.history.replaceState({}, '', url);
		});
		if (handoff) {
			rememberDaemonConnection(data.user.id, handoff, sessionStorage, localStorage);
		}
		const savedConnection = readDaemonConnection(data.user.id, sessionStorage, localStorage);
		daemonUrl = savedConnection?.url ?? '';
		daemonToken = savedConnection?.token ?? '';
		directServerUrl = page.url.searchParams.get('server') ?? '';
		void loadAccountData();
	});

	async function loadAccountData(): Promise<void> {
		loading = true;
		const [accountResult, sessionResult] = await Promise.all([
			authClient.listAccounts(),
			authClient.listSessions()
		]);
		accounts = accountResult.data ?? [];
		sessions = sessionResult.data ?? [];
		errorMessage = accountResult.error?.message ?? sessionResult.error?.message ?? '';
		loading = false;
	}

	function beginAction(action: string): void {
		pendingAction = action;
		notice = '';
		errorMessage = '';
	}

	function completeAction(message: string): void {
		pendingAction = '';
		notice = message;
	}

	function failAction(message: string | undefined): void {
		pendingAction = '';
		errorMessage = message ?? 'The account change failed.';
	}

	async function updateProfile(): Promise<void> {
		beginAction('profile');
		const result = await authClient.updateUser({
			name: name.trim(),
			image: image.trim() || null
		});
		if (result.error) return failAction(result.error.message);
		await invalidateAll();
		completeAction('Profile updated.');
	}

	async function changePassword(): Promise<void> {
		beginAction('password');
		const result = await authClient.changePassword({
			currentPassword,
			newPassword,
			revokeOtherSessions: true
		});
		if (result.error) return failAction(result.error.message);
		currentPassword = '';
		newPassword = '';
		await loadAccountData();
		completeAction('Password changed. Other sessions were signed out.');
	}

	async function revokeSession(token: string): Promise<void> {
		beginAction(`session:${token}`);
		const result = await authClient.revokeSession({ token });
		if (result.error) return failAction(result.error.message);
		await loadAccountData();
		completeAction('Session signed out.');
	}

	async function revokeOtherSessions(): Promise<void> {
		beginAction('other-sessions');
		const result = await authClient.revokeOtherSessions();
		if (result.error) return failAction(result.error.message);
		await loadAccountData();
		completeAction('Other sessions signed out.');
	}

	async function connectGitHub(): Promise<void> {
		beginAction('github');
		const result = await authClient.linkSocial({
			provider: 'github',
			callbackURL: '/account'
		});
		if (result?.error) failAction(result.error.message);
	}

	async function unlinkGitHub(): Promise<void> {
		beginAction('github');
		const result = await authClient.unlinkAccount({ providerId: 'github' });
		if (result.error) return failAction(result.error.message);
		await loadAccountData();
		completeAction('GitHub disconnected.');
	}

	async function signOut(): Promise<void> {
		beginAction('sign-out');
		const result = await authClient.signOut();
		if (result.error) return failAction(result.error.message);
		await invalidateAll();
		await goto(resolve('/'));
	}

	async function deleteAccount(): Promise<void> {
		if (deleteConfirmation !== 'DELETE') return;
		beginAction('delete');
		const result = await authClient.deleteUser({
			...(deletePassword ? { password: deletePassword } : {}),
			callbackURL: '/'
		});
		if (result.error) return failAction(result.error.message);
		await invalidateAll();
		await goto(resolve('/'));
	}

	function describeDevice(userAgent: string | null | undefined): string {
		if (!userAgent) return 'Unknown device';
		if (/iPhone|iPad/i.test(userAgent)) return 'iPhone or iPad';
		if (/Android/i.test(userAgent)) return 'Android device';
		if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
		if (/Windows/i.test(userAgent)) return 'Windows device';
		if (/Linux/i.test(userAgent)) return 'Linux device';
		return 'Browser session';
	}

	function formatDate(value: Date): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
	}

	function connectionFailureMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Unable to connect.';
	}

	async function connectToDaemon(): Promise<void> {
		testingConnection = true;
		connectionError = '';
		try {
			const connection = normalizeDaemonConnection({ url: daemonUrl, token: daemonToken });
			await listDaemonProjects(connection);
			rememberDaemonConnection(data.user.id, connection, sessionStorage, localStorage);
			await goto(resolve('/c'));
		} catch (error: unknown) {
			connectionError =
				loopbackPermissionMessage(await getLoopbackPermissionState()) ??
				connectionFailureMessage(error);
		} finally {
			testingConnection = false;
		}
	}

	async function connectDirectly(): Promise<void> {
		testingConnection = true;
		connectionError = '';
		try {
			const serverUrl = normalizeServerUrl(directServerUrl);
			await getHealth({ kind: 'direct', serverUrl });
			forgetDaemonConnection(data.user.id, sessionStorage, localStorage);
			await goto(`${resolve('/c')}?server=${encodeURIComponent(serverUrl)}`);
		} catch (error: unknown) {
			connectionError = connectionFailureMessage(error);
		} finally {
			testingConnection = false;
		}
	}
</script>

<svelte:head>
	<title>Account · Chump</title>
	<meta name="description" content="Manage your Chump account and sessions" />
</svelte:head>

<div class="space-y-6">
	<!-- Page Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-text-inverse sm:text-3xl">
				Account Settings
			</h1>
			<p class="mt-1 text-sm text-text-tertiary">
				{data.user.email}
			</p>
		</div>
		<button
			class="button-secondary shrink-0 text-xs"
			disabled={pendingAction === 'sign-out'}
			onclick={() => void signOut()}
		>
			{pendingAction === 'sign-out' ? 'Signing out…' : 'Sign out'}
		</button>
	</div>

	<!-- Navigation Tabs -->
	<div class="flex items-center gap-1 border-b border-border-default pb-3 overflow-x-auto">
		<a
			href={resolve('/account?tab=profile')}
			class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
			class:bg-bg-hover={currentTab === 'profile'}
			class:text-text-inverse={currentTab === 'profile'}
			class:text-text-secondary={currentTab !== 'profile'}
			class:hover:text-text-main={currentTab !== 'profile'}
		>
			Preferences & Profile
		</a>
		<a
			href={resolve('/account?tab=security')}
			class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
			class:bg-bg-hover={currentTab === 'security'}
			class:text-text-inverse={currentTab === 'security'}
			class:text-text-secondary={currentTab !== 'security'}
			class:hover:text-text-main={currentTab !== 'security'}
		>
			<span>Security & Sessions</span>
			{#if sessions.length > 0}
				<span class="rounded-full bg-bg-input px-1.5 py-0.2 text-[10px] text-text-tertiary">
					{sessions.length}
				</span>
			{/if}
		</a>
		<a
			href={resolve('/account?tab=connection')}
			class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
			class:bg-bg-hover={currentTab === 'connection'}
			class:text-text-inverse={currentTab === 'connection'}
			class:text-text-secondary={currentTab !== 'connection'}
			class:hover:text-text-main={currentTab !== 'connection'}
		>
			<span>Connections</span>
		</a>
	</div>

	<!-- Status Banners -->
	{#if notice}
		<p class="rounded-xl bg-bg-toast-ok px-4 py-3 text-sm text-text-success border border-text-success/20" role="status">
			{notice}
		</p>
	{/if}
	{#if errorMessage}
		<p class="rounded-xl bg-bg-toast-err px-4 py-3 text-sm text-text-error border border-text-error/20" role="alert">
			{errorMessage}
		</p>
	{/if}

	<!-- TAB: PROFILE -->
	{#if currentTab === 'profile'}
		<div class="space-y-6 max-w-2xl">
			<section class="rounded-2xl border border-border-default bg-bg-surface p-6 shadow-xs">
				<h2 class="text-base font-semibold text-text-inverse">Profile Details</h2>
				<p class="mt-0.5 text-xs text-text-tertiary">Update the identity shown in Chump Web.</p>

				<form class="mt-5 space-y-4" onsubmit={(event) => { event.preventDefault(); void updateProfile(); }}>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Display Name</span>
						<input
							class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm text-text-main outline-none focus:border-accent transition-colors"
							bind:value={name}
							required
							maxlength="80"
							autocomplete="name"
						/>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Avatar URL</span>
						<input
							class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm text-text-main outline-none focus:border-accent transition-colors"
							bind:value={image}
							type="url"
							inputmode="url"
							placeholder="https://..."
						/>
					</label>

					<div class="pt-2">
						<button class="button-primary" type="submit" disabled={pendingAction === 'profile'}>
							{pendingAction === 'profile' ? 'Saving profile…' : 'Save Profile'}
						</button>
					</div>
				</form>
			</section>
		</div>
	{/if}

	<!-- TAB: SECURITY & SESSIONS -->
	{#if currentTab === 'security'}
		<div class="space-y-6">
			<!-- Sign-in Methods -->
			<section class="rounded-2xl border border-border-default bg-bg-surface p-6 shadow-xs">
				<h2 class="text-base font-semibold text-text-inverse">Sign-in Methods</h2>
				<p class="mt-0.5 text-xs text-text-tertiary">Authentication providers connected to your account.</p>

				<div class="mt-4 divide-y divide-border-default rounded-xl border border-border-default bg-bg-input">
					<div class="flex items-center justify-between gap-4 p-4">
						<div>
							<p class="text-sm font-medium text-text-main">Email and password</p>
							<p class="mt-0.5 text-xs text-text-tertiary">{hasPassword ? 'Connected' : 'Not connected'}</p>
						</div>
						<span class="font-mono text-[10px] uppercase tracking-wider text-text-tertiary bg-bg-surface px-2 py-1 rounded border border-border-default">
							{hasPassword ? 'Active' : 'Unavailable'}
						</span>
					</div>

					{#if data.githubAuthEnabled}
						<div class="flex items-center justify-between gap-4 p-4">
							<div>
								<p class="text-sm font-medium text-text-main">GitHub</p>
								<p class="mt-0.5 text-xs text-text-tertiary">{hasGitHub ? 'Connected' : 'Not connected'}</p>
							</div>
							{#if hasGitHub}
								<button
									class="button-secondary text-xs"
									disabled={accounts.length <= 1 || pendingAction === 'github'}
									title={accounts.length <= 1 ? 'Add another sign-in method before disconnecting GitHub' : undefined}
									onclick={() => void unlinkGitHub()}
								>
									Disconnect
								</button>
							{:else}
								<button
									class="button-secondary text-xs"
									disabled={pendingAction === 'github'}
									onclick={() => void connectGitHub()}
								>
									Connect
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</section>

			<!-- Change Password -->
			{#if hasPassword}
				<section class="rounded-2xl border border-border-default bg-bg-surface p-6 shadow-xs">
					<h2 class="text-base font-semibold text-text-inverse">Password</h2>
					<p class="mt-0.5 text-xs text-text-tertiary">Changing your password revokes all other active sessions.</p>

					<form class="mt-4 grid gap-4 sm:grid-cols-2" onsubmit={(event) => { event.preventDefault(); void changePassword(); }}>
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-text-secondary">Current Password</span>
							<input
								class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm outline-none focus:border-accent"
								bind:value={currentPassword}
								type="password"
								autocomplete="current-password"
								required
							/>
						</label>
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-text-secondary">New Password</span>
							<input
								class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm outline-none focus:border-accent"
								bind:value={newPassword}
								type="password"
								autocomplete="new-password"
								minlength="10"
								maxlength="128"
								required
							/>
						</label>
						<div class="sm:col-span-2 pt-1">
							<button class="button-primary" type="submit" disabled={pendingAction === 'password'}>
								{pendingAction === 'password' ? 'Changing…' : 'Change Password'}
							</button>
						</div>
					</form>
				</section>
			{/if}

			<!-- Active Sessions -->
			<section class="rounded-2xl border border-border-default bg-bg-surface p-6 shadow-xs">
				<div class="flex items-center justify-between gap-4 pb-3 border-b border-border-default">
					<div>
						<h2 class="text-base font-semibold text-text-inverse">Active Sessions</h2>
						<p class="mt-0.5 text-xs text-text-tertiary">Devices currently signed in to this account.</p>
					</div>
					{#if sessions.length > 1}
						<button
							class="button-secondary text-xs"
							disabled={pendingAction === 'other-sessions'}
							onclick={() => void revokeOtherSessions()}
						>
							Sign out other devices
						</button>
					{/if}
				</div>

				<div class="mt-4 divide-y divide-border-default rounded-xl border border-border-default bg-bg-input">
					{#if loading}
						<p class="p-4 text-xs text-text-tertiary">Loading sessions…</p>
					{:else}
						{#each sessions as item (item.id)}
							<div class="flex items-center justify-between gap-4 p-4">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-text-main">{describeDevice(item.userAgent)}</p>
									<p class="mt-0.5 text-xs text-text-tertiary">
										{item.token === data.session.token ? 'Current Device' : `Expires ${formatDate(item.expiresAt)}`}
									</p>
								</div>
								{#if item.token !== data.session.token}
									<button
										class="button-secondary text-xs"
										disabled={pendingAction === `session:${item.token}`}
										onclick={() => void revokeSession(item.token)}
									>
										Sign Out
									</button>
								{/if}
							</div>
						{:else}
							<p class="p-4 text-xs text-text-tertiary">No active sessions found.</p>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Danger Zone: Delete Account -->
			<section class="rounded-2xl border border-text-error/30 bg-text-error/5 p-6 shadow-xs">
				<h2 class="text-base font-semibold text-text-error">Danger Zone</h2>
				<p class="mt-0.5 text-xs text-text-tertiary">
					Permanently remove this user account and active web sessions.
				</p>

				<form class="mt-4 space-y-4 max-w-md" onsubmit={(event) => { event.preventDefault(); void deleteAccount(); }}>
					{#if hasPassword}
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-text-secondary">Current Password</span>
							<input
								class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm outline-none focus:border-text-error"
								bind:value={deletePassword}
								type="password"
								autocomplete="current-password"
								required
							/>
						</label>
					{/if}
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Type DELETE to confirm</span>
						<input
							class="w-full rounded-xl border border-border-default bg-bg-input px-3.5 py-2.5 text-sm font-mono outline-none focus:border-text-error"
							bind:value={deleteConfirmation}
							autocomplete="off"
							required
						/>
					</label>
					<button
						class="rounded-xl border border-text-error/40 bg-text-error/10 px-4 py-2.5 text-xs font-semibold text-text-error transition-colors hover:bg-text-error hover:text-white disabled:opacity-40"
						type="submit"
						disabled={deleteConfirmation !== 'DELETE' || pendingAction === 'delete'}
					>
						{pendingAction === 'delete' ? 'Deleting account…' : 'Delete Account'}
					</button>
				</form>
			</section>
		</div>
	{/if}

	{#if currentTab === 'connection'}
		<div class="grid max-w-3xl gap-4 lg:grid-cols-2">
			<section class="rounded-xl border border-border-default bg-bg-surface p-5 shadow-xs">
				<div class="flex items-start gap-3">
					<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-input text-text-secondary">
						<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M5 12h14M5 12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2M5 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2m-2-4h.01M17 16h.01" />
						</svg>
					</div>
					<div>
						<h2 class="text-sm font-semibold text-text-inverse">Host daemon</h2>
						<p class="mt-0.5 text-xs leading-relaxed text-text-tertiary">Connect to projects managed by your local Chump daemon.</p>
					</div>
				</div>

				<form class="mt-5 space-y-3" onsubmit={(event) => { event.preventDefault(); void connectToDaemon(); }}>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Daemon URL</span>
						<input
							bind:value={daemonUrl}
							class="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-xs text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
							placeholder="http://127.0.0.1:9417"
							type="url"
							required
						/>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Daemon token</span>
						<input
							bind:value={daemonToken}
							class="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-xs text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
							placeholder="Token"
							type="password"
							autocomplete="off"
							required
						/>
					</label>
					<button class="button-primary w-full" type="submit" disabled={testingConnection}>
						{testingConnection ? 'Connecting…' : 'Connect to projects'}
					</button>
				</form>
			</section>

			<section class="rounded-xl border border-border-default bg-bg-surface p-5 shadow-xs">
				<div class="flex items-start gap-3">
					<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-input text-text-secondary">
						<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M13 10V3L4 14h7v7l9-11h-7Z" />
						</svg>
					</div>
					<div>
						<h2 class="text-sm font-semibold text-text-inverse">Direct server</h2>
						<p class="mt-0.5 text-xs leading-relaxed text-text-tertiary">Connect directly to a running Chump server URL.</p>
					</div>
				</div>

				<form class="mt-5 space-y-3" onsubmit={(event) => { event.preventDefault(); void connectDirectly(); }}>
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Server URL</span>
						<input
							bind:value={directServerUrl}
							class="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-xs text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
							placeholder="http://127.0.0.1:8000"
							type="url"
							required
						/>
					</label>
					<button class="button-secondary w-full" type="submit" disabled={testingConnection}>
						{testingConnection ? 'Connecting…' : 'Connect directly'}
					</button>
				</form>
			</section>
		</div>

		{#if connectionError}
			<p class="max-w-3xl rounded-lg border border-text-error/20 bg-bg-toast-err px-3 py-2 text-xs text-text-error" role="alert">
				{connectionError}
			</p>
		{/if}
	{/if}
</div>

<style>
	:global(.button-primary),
	:global(.button-secondary) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.75rem;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 600;
		transition: opacity 0.15s ease, background-color 0.15s ease;
	}
	:global(.button-primary) {
		background: var(--color-accent);
		color: var(--color-text-on-accent);
	}
	:global(.button-primary:hover) {
		opacity: 0.9;
	}
	:global(.button-secondary) {
		border: 1px solid var(--color-border-default);
		background: var(--color-bg-surface);
		color: var(--color-text-main);
	}
	:global(.button-secondary:hover) {
		background: var(--color-bg-hover);
	}
</style>
