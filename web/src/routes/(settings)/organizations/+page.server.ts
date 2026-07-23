import { redirect } from '@sveltejs/kit';
import { safeAuthRedirect } from '$lib/auth/redirect';
import { ensurePersonalWorkspace } from '$lib/server/personal-workspace';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request, url }) => {
	if (!locals.auth || !locals.user || !locals.session) {
		const invitationId = url.searchParams.get('invitationId');
		const destination = invitationId
			? `/organizations?invitationId=${encodeURIComponent(invitationId)}`
			: '/organizations';
		redirect(303, `/auth?redirectTo=${encodeURIComponent(destination)}`);
	}

	await ensurePersonalWorkspace(
		locals.auth,
		request.headers,
		locals.user,
		locals.session.activeOrganizationId
	);

	return {
		user: locals.user!,
		invitationId: url.searchParams.get('invitationId'),
		redirectTo: safeAuthRedirect(url.searchParams.get('redirectTo'))
	};
};
