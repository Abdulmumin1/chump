import { describe, expect, it, vi } from 'vitest';
import { getLoopbackPermissionState, loopbackPermissionMessage } from './loopback-permission';

describe('loopback permission', () => {
	it('reads Chrome’s loopback permission', async () => {
		const query = vi.fn().mockResolvedValue({ state: 'granted' });

		await expect(getLoopbackPermissionState(query)).resolves.toBe('granted');
		expect(query).toHaveBeenCalledWith({ name: 'loopback-network' });
	});

	it('falls back to Chrome’s legacy local network permission name', async () => {
		const query = vi.fn()
			.mockRejectedValueOnce(new TypeError('unsupported permission'))
			.mockResolvedValueOnce({ state: 'prompt' });

		await expect(getLoopbackPermissionState(query)).resolves.toBe('prompt');
		expect(query).toHaveBeenLastCalledWith({ name: 'local-network-access' });
	});

	it('provides actionable messages for prompt and denied states', () => {
		expect(loopbackPermissionMessage('prompt')).toContain('Connect to projects');
		expect(loopbackPermissionMessage('denied')).toContain('site’s settings');
		expect(loopbackPermissionMessage('granted')).toBeNull();
	});
});
