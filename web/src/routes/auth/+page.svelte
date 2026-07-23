<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let mode = $state<'sign-in' | 'sign-up'>('sign-in');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	async function submitEmail(): Promise<void> {
		if (pending) return;
		pending = true;
		errorMessage = '';

		const result = mode === 'sign-in'
			? await authClient.signIn.email({ email, password })
			: await authClient.signUp.email({ name, email, password });

		pending = false;
		if (result.error) {
			errorMessage = result.error.message ?? 'Authentication failed.';
			return;
		}

		await invalidateAll();
		await goto(resolve(data.redirectTo));
	}

	async function signInWithGitHub(): Promise<void> {
		if (pending) return;
		pending = true;
		errorMessage = '';
		const result = await authClient.signIn.social({
			provider: 'github',
			callbackURL: data.redirectTo
		});
		if (result?.error) {
			pending = false;
			errorMessage = result.error.message ?? 'GitHub sign-in failed.';
		}
	}

	function switchMode(nextMode: 'sign-in' | 'sign-up'): void {
		mode = nextMode;
		errorMessage = '';
	}
</script>

<svelte:head>
	<title>{mode === 'sign-in' ? 'Sign in' : 'Create account'} · Chump</title>
	<meta name="description" content="Sign in to Chump Web" />
</svelte:head>

<main class="min-h-[100dvh] bg-bg-body px-4 py-10 text-text-main sm:py-16">
	<div class="mx-auto w-full max-w-md">
		<a href={resolve('/')} class="mb-10 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-text-secondary hover:text-text-main">
			<span aria-hidden="true">←</span> Chump
		</a>

		<section class="rounded-2xl border border-border-default bg-bg-surface p-6 sm:p-8">
			<p class="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-text-tertiary">Chump Web</p>
			<h1 class="text-3xl font-semibold tracking-tight text-text-inverse">
				{mode === 'sign-in' ? 'Welcome back.' : 'Create your account.'}
			</h1>
			<p class="mt-2 text-sm leading-6 text-text-secondary">
				{mode === 'sign-in'
					? 'Sign in to connect to your Chump server.'
					: 'Your account gates Chump Web. Server authorization stays separate.'}
			</p>

			<div class="mt-6 grid grid-cols-2 rounded-xl bg-bg-elevated p-1" aria-label="Authentication mode">
				<button
					type="button"
					class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
					class:bg-bg-surface={mode === 'sign-in'}
					class:text-text-main={mode === 'sign-in'}
					class:text-text-tertiary={mode !== 'sign-in'}
					onclick={() => switchMode('sign-in')}
				>Sign in</button>
				<button
					type="button"
					class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
					class:bg-bg-surface={mode === 'sign-up'}
					class:text-text-main={mode === 'sign-up'}
					class:text-text-tertiary={mode !== 'sign-up'}
					onclick={() => switchMode('sign-up')}
				>Create account</button>
			</div>

			{#if data.githubAuthEnabled}
				<button
					type="button"
					class="button-secondary mt-6 w-full py-2.5"
					disabled={pending}
					onclick={() => void signInWithGitHub()}
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.36-3.9-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.3-5.28-1.29-5.28-5.69 0-1.26.45-2.28 1.2-3.09-.12-.29-.52-1.46.11-3.05 0 0 .98-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.75.81 1.2 1.83 1.2 3.09 0 4.42-2.72 5.39-5.3 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
					</svg>
					Continue with GitHub
				</button>
				<div class="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-text-muted">
					<span class="h-px flex-1 bg-border-default"></span><span>or</span><span class="h-px flex-1 bg-border-default"></span>
				</div>
			{/if}

			<form onsubmit={(event) => { event.preventDefault(); void submitEmail(); }}>
				{#if mode === 'sign-up'}
					<label class="mb-4 block">
						<span class="mb-1.5 block text-xs font-medium text-text-secondary">Display name</span>
						<input class="w-full rounded-xl border border-border-default bg-bg-input px-3 py-2.5 text-text-main outline-none transition-colors focus:border-accent" bind:value={name} autocomplete="name" required maxlength="80" />
					</label>
				{/if}
				<label class="mb-4 block">
					<span class="mb-1.5 block text-xs font-medium text-text-secondary">Email</span>
					<input class="w-full rounded-xl border border-border-default bg-bg-input px-3 py-2.5 text-text-main outline-none transition-colors focus:border-accent" bind:value={email} type="email" autocomplete="email" required />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs font-medium text-text-secondary">Password</span>
					<input class="w-full rounded-xl border border-border-default bg-bg-input px-3 py-2.5 text-text-main outline-none transition-colors focus:border-accent" bind:value={password} type="password" autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minlength="10" maxlength="128" />
					{#if mode === 'sign-up'}<span class="mt-1.5 block text-[11px] text-text-tertiary">Use at least 10 characters.</span>{/if}
				</label>

				{#if errorMessage}
					<p class="mt-4 rounded-lg bg-bg-toast-err px-3 py-2 text-sm text-text-error" role="alert">{errorMessage}</p>
				{/if}

				<button type="submit" class="button-primary mt-5 w-full py-2.5" disabled={pending}>
					{pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
				</button>
			</form>
		</section>
	</div>
</main>
