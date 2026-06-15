/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;

const ASSETS = [
	...build, // compiled JS, CSS, and Svelte assets
	...files   // static assets (icons, etc.)
];

self.addEventListener('install', (event: any) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
		await self.skipWaiting();
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event: any) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
		await self.clients.claim();
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event: any) => {
	if (event.request.method !== 'GET') return;
	const requestUrl = new URL(event.request.url);
	if (requestUrl.origin !== self.location.origin) return;

	async function respond() {
		const url = requestUrl;
		const cache = await caches.open(CACHE);

		// Serve static assets/build files directly from the cache
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) return cachedResponse;
		}

		// Otherwise, go network-first, fallback to cache
		try {
			const response = await fetch(event.request);
			if (
				event.request.mode === 'navigate' &&
				response.ok &&
				response.type === 'basic' &&
				response.headers.get('vary') !== '*'
			) {
				try {
					await cache.put(event.request, response.clone());
				} catch {
					// A cache write must not fail an otherwise successful request.
				}
			}
			return response;
		} catch {
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) return cachedResponse;
			return new Response('Offline', { status: 408, headers: { 'Content-Type': 'text/plain' } });
		}
	}

	event.respondWith(respond());
});
