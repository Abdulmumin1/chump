import { redirect } from '@sveltejs/kit';
import { ensurePersonalWorkspace } from '$lib/server/personal-workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request, url }) => {
	if (!locals.auth || !locals.user || !locals.session) {
		const returnTo = `${url.pathname}${url.search}`;
		redirect(303, `/auth?redirectTo=${encodeURIComponent(returnTo)}`);
	}

	await ensurePersonalWorkspace(
		locals.auth,
		request.headers,
		locals.user,
		locals.session.activeOrganizationId
	);

	return {
		initialServerUrl: normalizeQueryValue(url.searchParams.get('server')),
		initialSessionId: normalizeQueryValue(url.searchParams.get('session')) ?? '',
		user: locals.user
	};
};

function normalizeQueryValue(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
