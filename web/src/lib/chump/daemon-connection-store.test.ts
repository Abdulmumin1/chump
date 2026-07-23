import { describe, expect, it } from 'vitest';
import {
	forgetDaemonConnection,
	readDaemonConnection,
	rememberDaemonConnection
} from './daemon-connection-store';

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

describe('daemon connection store', () => {
	it('persists a successful connection for the authenticated user', () => {
		const session = createStorage();
		const local = createStorage();
		const connection = { url: 'http://127.0.0.1:9417', token: 'secret-token' };

		rememberDaemonConnection('user-a', connection, session, local);
		session.clear();

		expect(readDaemonConnection('user-a', session, local)).toEqual(connection);
		expect(readDaemonConnection('user-b', session, local)).toBeNull();
	});

	it('does not expose another authenticated user’s transient connection', () => {
		const session = createStorage();
		const local = createStorage();
		rememberDaemonConnection(
			'user-a',
			{ url: 'http://127.0.0.1:9417', token: 'user-a-token' },
			session,
			local
		);

		expect(readDaemonConnection('user-b', session, local)).toBeNull();
	});

	it('prefers a fresh CLI handoff over the saved connection', () => {
		const session = createStorage();
		const local = createStorage();
		rememberDaemonConnection(
			'user-a',
			{ url: 'http://127.0.0.1:9417', token: 'old-token' },
			session,
			local
		);
		session.setItem('chump:daemon-url', 'http://127.0.0.1:9517');
		session.setItem('chump:daemon-token', 'new-token');

		expect(readDaemonConnection('user-a', session, local)).toEqual({
			url: 'http://127.0.0.1:9517',
			token: 'new-token'
		});
	});

	it('forgets both transient and persistent credentials', () => {
		const session = createStorage();
		const local = createStorage();
		rememberDaemonConnection(
			'user-a',
			{ url: 'http://127.0.0.1:9417', token: 'secret-token' },
			session,
			local
		);

		forgetDaemonConnection('user-a', session, local);

		expect(readDaemonConnection('user-a', session, local)).toBeNull();
	});
});
