import { describe, expect, it } from 'vitest';
import {
	forgetLocalServiceConnection,
	readLocalServiceConnection,
	rememberLocalServiceConnection
} from './local-service-connection-store';

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

describe('local service connection store', () => {
	it('persists a successful connection for the authenticated user', () => {
		const session = createStorage();
		const local = createStorage();
		const connection = { url: 'http://127.0.0.1:9417', token: 'secret-token' };

		rememberLocalServiceConnection('user-a', connection, session, local);
		session.clear();

		expect(readLocalServiceConnection('user-a', session, local)).toEqual(connection);
		expect(readLocalServiceConnection('user-b', session, local)).toBeNull();
	});

	it('does not expose another authenticated user’s transient connection', () => {
		const session = createStorage();
		const local = createStorage();
		rememberLocalServiceConnection(
			'user-a',
			{ url: 'http://127.0.0.1:9417', token: 'user-a-token' },
			session,
			local
		);

		expect(readLocalServiceConnection('user-b', session, local)).toBeNull();
	});

	it('forgets saved credentials', () => {
		const session = createStorage();
		const local = createStorage();
		rememberLocalServiceConnection(
			'user-a',
			{ url: 'http://127.0.0.1:9417', token: 'secret-token' },
			session,
			local
		);

		forgetLocalServiceConnection('user-a', session, local);

		expect(readLocalServiceConnection('user-a', session, local)).toBeNull();
	});
});
