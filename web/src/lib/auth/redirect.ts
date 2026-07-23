const DEFAULT_AUTH_REDIRECT = '/c';
export type AuthRedirect =
	| '/c'
	| '/account'
	| '/organizations'
	| `/c?${string}`
	| `/account?${string}`
	| `/organizations?${string}`;

export function safeAuthRedirect(value: string | null | undefined): AuthRedirect {
	if (!value || !value.startsWith('/') || value.startsWith('//')) {
		return DEFAULT_AUTH_REDIRECT;
	}

	try {
		const parsed = new URL(value, 'https://chump.local');
		if (
			parsed.origin !== 'https://chump.local' ||
			(parsed.pathname !== '/c' &&
				parsed.pathname !== '/account' &&
				parsed.pathname !== '/organizations')
		) {
			return DEFAULT_AUTH_REDIRECT;
		}

		return `${parsed.pathname}${parsed.search}` as AuthRedirect;
	} catch {
		return DEFAULT_AUTH_REDIRECT;
	}
}
