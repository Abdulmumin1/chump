import { safeAuthRedirect } from '$lib/auth/redirect';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const redirectTo = safeAuthRedirect(url.searchParams.get('redirectTo'));

	if (locals.user) {
		redirect(303, redirectTo);
	}

	return {
		redirectTo,
		githubAuthEnabled: locals.githubAuthEnabled
	};
};
