import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const detectedServerUrl = await readDetectedServerUrl();
	const requestedServerUrl = normalizeQueryValue(url.searchParams.get('server'));
	const requestedSessionId = normalizeQueryValue(url.searchParams.get('session'));

	return {
		detectedServerUrl,
		initialServerUrl: requestedServerUrl ?? detectedServerUrl,
		initialSessionId: requestedSessionId ?? ''
	};
};

async function readDetectedServerUrl(): Promise<string | null> {
	const metadataPath = fileURLToPath(new URL('../../../.chump/server.json', import.meta.url));

	try {
		const raw = await readFile(metadataPath, 'utf-8');
		const parsed = JSON.parse(raw) as { url?: unknown };
		return typeof parsed.url === 'string' && parsed.url.length > 0 ? parsed.url : null;
	} catch {
		return null;
	}
}

function normalizeQueryValue(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
