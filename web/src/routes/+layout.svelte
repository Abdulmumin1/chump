<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import {
		consumeDaemonHandoff,
		dispatchPendingDaemonHandoff,
		stageDaemonHandoff
	} from '$lib/chump/daemon-handoff';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		const handoff = consumeDaemonHandoff(window.location.href, sessionStorage, (url) => {
			window.history.replaceState({}, '', url);
		});
		if (handoff) {
			stageDaemonHandoff(localStorage, handoff);
			dispatchPendingDaemonHandoff(window, handoff);
		}

		if ('serviceWorker' in navigator && !dev) {
			navigator.serviceWorker.register('/service-worker.js', {
				type: 'module'
			}).catch((err) => {
				console.warn('SvelteKit ServiceWorker registration failed: ', err);
			});
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
