import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_DAEMON_PORT,
	DEFAULT_DAEMON_URL,
	discoverDefaultDaemon
} from './daemon-api';

describe('default daemon discovery', () => {
	it('uses the chmp-derived stable default daemon port', () => {
		expect(DEFAULT_DAEMON_PORT).toBe(38136);
		expect(DEFAULT_DAEMON_URL).toBe('http://127.0.0.1:38136');
	});

	it('reuses a saved daemon token against the default port', async () => {
		const local = createStorage();
		const session = createStorage();
		session.setItem('chump:daemon-token', 'saved-token');
		vi.stubGlobal('localStorage', local);
		vi.stubGlobal('sessionStorage', session);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				expect(String(input)).toBe('http://127.0.0.1:38136/health');
				return Response.json({ service: 'chump-daemon' });
			})
		);

		await expect(discoverDefaultDaemon()).resolves.toEqual({
			url: 'http://127.0.0.1:38136',
			token: 'saved-token'
		});

		vi.unstubAllGlobals();
	});
});

function createStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value)
	};
}
