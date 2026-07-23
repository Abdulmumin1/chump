import { building } from '$app/environment';
import { createAuth, hasGitHubAuth, type AuthEnvironment } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.auth = null;
	event.locals.user = null;
	event.locals.session = null;
	event.locals.githubAuthEnabled = false;

	if (isUserScopedPage(event.url.pathname)) {
		event.setHeaders({
			'cache-control': 'private, no-store'
		});
	}

	if (building) {
		return resolve(event);
	}

	const environment = event.platform?.env as AuthEnvironment | undefined;
	if (!environment?.DB) {
		throw new Error('Cloudflare D1 binding DB is required');
	}

	const auth = createAuth(environment);
	event.locals.auth = auth;
	event.locals.githubAuthEnabled = hasGitHubAuth(environment);

	if (!event.url.pathname.startsWith('/api/auth/')) {
		const current = await auth.api.getSession({
			headers: event.request.headers
		});
		event.locals.user = current?.user ?? null;
		event.locals.session = current?.session ?? null;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

function isUserScopedPage(pathname: string): boolean {
	return (
		pathname === '/' ||
		pathname === '/auth' ||
		pathname === '/account' ||
		pathname === '/organizations' ||
		pathname === '/c'
	);
}
