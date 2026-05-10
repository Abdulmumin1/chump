import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const requestedServerUrl = normalizeQueryValue(url.searchParams.get('server'));
	const requestedSessionId = normalizeQueryValue(url.searchParams.get('session'));

	return {
		initialServerUrl: requestedServerUrl,
		initialSessionId: requestedSessionId ?? ''
	};
};

function normalizeQueryValue(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
