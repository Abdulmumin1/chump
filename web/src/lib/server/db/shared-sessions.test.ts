import { describe, expect, it } from 'vitest';
import { generateSharedSessionSlug } from './shared-sessions';

describe('shared session slugs', () => {
	it('generates short lowercase alphanumeric slugs', () => {
		const slug = generateSharedSessionSlug();
		expect(slug).toMatch(/^[a-z0-9]{12}$/);
	});

	it('generates distinct slugs', () => {
		const slugs = new Set(Array.from({ length: 100 }, generateSharedSessionSlug));
		expect(slugs.size).toBe(100);
	});
});
