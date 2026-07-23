import { describe, expect, it } from 'vitest';
import { safeAuthRedirect } from './redirect';

describe('safeAuthRedirect', () => {
	it('keeps local paths and query parameters', () => {
		expect(safeAuthRedirect('/c?server=http%3A%2F%2Flocalhost%3A8000')).toBe(
			'/c?server=http%3A%2F%2Flocalhost%3A8000'
		);
	});

	it('allows organization invitation redirects', () => {
		expect(safeAuthRedirect('/organizations?invitationId=invite-1')).toBe(
			'/organizations?invitationId=invite-1'
		);
	});

	it.each([null, '', '/unknown', 'https://attacker.example', '//attacker.example'])(
		'falls back for unsafe redirect %s',
		(value) => {
			expect(safeAuthRedirect(value)).toBe('/c');
		}
	);
});
