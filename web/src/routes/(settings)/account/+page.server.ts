import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user || !locals.session) {
		redirect(303, '/auth?redirectTo=/account');
	}

	return {
		user: locals.user,
		session: locals.session,
		githubAuthEnabled: locals.githubAuthEnabled
	};
};
