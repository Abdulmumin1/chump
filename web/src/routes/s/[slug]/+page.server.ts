import { error } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/d1';
import { getSharedSession } from '$lib/server/db/shared-sessions';
import { buildTranscript } from '$lib/chat/transcript';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
	const db = platform?.env?.DB;
	if (!db) {
		error(500, 'Database binding is unavailable');
	}

	const row = await getSharedSession(drizzle(db), params.slug);
	if (!row) {
		error(404, 'Shared session not found');
	}

	setHeaders({
		'cache-control': 'public, max-age=300'
	});

	return {
		slug: row.slug,
		title: row.title,
		createdAt: row.createdAt,
		transcript: buildTranscript(row.messages)
	};
};
