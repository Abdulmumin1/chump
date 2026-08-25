import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { sharedSession } from './schema';
import type { StoredMessage } from '$lib/chump/types';

type SharedSessionRow = typeof sharedSession.$inferSelect;

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 12;
const MAX_CREATE_ATTEMPTS = 5;

export type CreateSharedSessionInput = {
	title: string;
	messages: StoredMessage[];
};

export function generateSharedSessionSlug(): string {
	const random = new Uint8Array(SLUG_LENGTH);
	crypto.getRandomValues(random);
	let slug = '';
	for (let index = 0; index < random.length; index += 1) {
		slug += SLUG_ALPHABET[random[index]! % SLUG_ALPHABET.length];
	}
	return slug;
}

export async function createSharedSession(
	db: DrizzleD1Database,
	input: CreateSharedSessionInput
): Promise<SharedSessionRow> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
		const row = {
			slug: generateSharedSessionSlug(),
			title: input.title,
			messages: input.messages,
			createdAt: new Date()
		};
		try {
			await db.insert(sharedSession).values(row).run();
			return row;
		} catch (error) {
			// Slug collisions are the only expected failure; retry with a fresh slug.
			lastError = error;
		}
	}
	throw lastError ?? new Error('Failed to create shared session');
}

export async function getSharedSession(
	db: DrizzleD1Database,
	slug: string
): Promise<SharedSessionRow | null> {
	return (
		(await db.select().from(sharedSession).where(eq(sharedSession.slug, slug)).get()) ?? null
	);
}
