<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import {
		consumeDaemonHandoff,
		dispatchPendingDaemonHandoff,
		prepareDaemonLaunchTarget,
		stageDaemonHandoff
	} from '$lib/chump/daemon-handoff';
	import type { DaemonConnection } from '$lib/chump/daemon-api';
	import '../app.css';

	let { children } = $props();

	type LaunchParams = {
		targetURL?: string;
	};

	type LaunchQueueWindow = Window & {
		launchQueue?: {
			setConsumer(consumer: (params: LaunchParams) => void): void;
		};
	};

	onMount(() => {
		const publishHandoff = (handoff: DaemonConnection) => {
			stageDaemonHandoff(localStorage, handoff);
			dispatchPendingDaemonHandoff(window, handoff);
		};

		const consumeCurrentHandoff = () => {
			const handoff = consumeDaemonHandoff(window.location.href, sessionStorage, (url) => {
				window.history.replaceState({}, '', url);
			});
			if (handoff) publishHandoff(handoff);
		};

		consumeCurrentHandoff();
		window.addEventListener('hashchange', consumeCurrentHandoff);

		(window as LaunchQueueWindow).launchQueue?.setConsumer(({ targetURL }) => {
			if (!targetURL) return;
			const target = prepareDaemonLaunchTarget(targetURL, window.location.origin, sessionStorage);
			if (!target) return;

			if (target.connection) publishHandoff(target.connection);
			window.location.assign(target.url);
		});

		if ('serviceWorker' in navigator && !dev) {
			navigator.serviceWorker.register('/service-worker.js', {
				type: 'module'
			}).catch((err) => {
				console.warn('SvelteKit ServiceWorker registration failed: ', err);
			});
		}

		return () => window.removeEventListener('hashchange', consumeCurrentHandoff);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
