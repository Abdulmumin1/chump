export function defaultWorkspaceName(user: { name?: string | null; email?: string | null }): string {
	if (user.name && user.name.trim().length > 0) {
		return user.name.trim();
	}
	if (user.email && user.email.includes('@')) {
		const handle = user.email.split('@')[0];
		if (handle) return handle;
	}
	return 'Personal Workspace';
}

export async function personalWorkspaceSlug(userId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
	const suffix = Array.from(new Uint8Array(digest).slice(0, 10), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
	return `personal-${suffix}`;
}
