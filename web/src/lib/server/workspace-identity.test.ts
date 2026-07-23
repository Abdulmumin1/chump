import { describe, expect, it } from 'vitest';
import { defaultWorkspaceName, personalWorkspaceSlug } from './workspace-identity';

describe('personal workspace identity', () => {
	it('uses a stable, non-identifying slug for each user', async () => {
		const first = await personalWorkspaceSlug('user-1');
		const repeated = await personalWorkspaceSlug('user-1');
		const second = await personalWorkspaceSlug('user-2');

		expect(first).toBe(repeated);
		expect(first).not.toBe(second);
		expect(first).toMatch(/^personal-[a-f0-9]{20}$/);
		expect(first).not.toContain('user-1');
	});

	it('uses user name as default workspace name', () => {
		expect(defaultWorkspaceName({ name: 'Abdulmumin', email: 'abdul@example.com' })).toBe('Abdulmumin');
		expect(defaultWorkspaceName({ name: '', email: 'abdul@example.com' })).toBe('abdul');
		expect(defaultWorkspaceName({ name: null, email: null })).toBe('Personal Workspace');
	});
});
