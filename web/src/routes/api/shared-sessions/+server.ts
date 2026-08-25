import { json, error } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/d1';
import { createSharedSession } from '$lib/server/db/shared-sessions';
import type { RequestHandler } from './$types';
import type { MessagePart, StoredMessage } from '$lib/chump/types';

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGES = 1000;
const MAX_PAYLOAD_BYTES = 1_500_000;

type ShareRequestBody = {
	title?: unknown;
	messages?: unknown;
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = platform?.env?.DB;
	if (!db) {
		error(500, 'Database binding is unavailable');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		error(400, 'Request body must be a JSON object');
	}

	const payload = JSON.stringify(body);
	if (payload.length > MAX_PAYLOAD_BYTES) {
		error(400, `Session is too large to share (max ${MAX_PAYLOAD_BYTES / 1_000_000}MB)`);
	}

	const { title, messages } = body as ShareRequestBody;
	if (!Array.isArray(messages) || messages.length === 0) {
		error(400, 'messages must be a non-empty array');
	}
	if (messages.length > MAX_MESSAGES) {
		error(400, `messages exceeds the limit of ${MAX_MESSAGES}`);
	}
	if (!messages.every(isStoredMessage)) {
		error(400, 'messages contains an invalid entry');
	}

	const normalizedTitle =
		typeof title === 'string' && title.trim()
			? title.trim().slice(0, MAX_TITLE_LENGTH)
			: 'Chump session';

	const row = await createSharedSession(drizzle(db), {
		title: normalizedTitle,
		messages: messages as StoredMessage[]
	});

	return json({ slug: row.slug, url: `/s/${row.slug}` });
};

function isStoredMessage(value: unknown): value is StoredMessage {
	if (!value || typeof value !== 'object') return false;
	const message = value as Record<string, unknown>;
	if (typeof message.role !== 'string' || !message.role) return false;
	const content = message.content;
	if (typeof content === 'string') return true;
	if (Array.isArray(content)) return content.every(isMessagePart);
	return false;
}

function isMessagePart(value: unknown): value is MessagePart {
	if (!value || typeof value !== 'object') return false;
	const part = value as Record<string, unknown>;
	if (part.type !== undefined && typeof part.type !== 'string') return false;
	switch (part.type) {
		case 'text':
		case 'reasoning':
			return typeof part.text === 'string';
		case 'tool_call':
			return typeof part.tool_call === 'object' && part.tool_call !== null;
		case 'tool_result':
			return typeof part.tool_result === 'object' && part.tool_result !== null;
		case 'image':
			return typeof part.image === 'string' || typeof part.label === 'string';
		case undefined:
			return true;
		default:
			return true;
	}
}
