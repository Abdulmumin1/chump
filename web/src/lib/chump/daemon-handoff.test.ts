import { describe, expect, it, vi } from 'vitest';
import {
	clearPendingDaemonHandoff,
	consumeDaemonHandoff,
	DAEMON_TOKEN_STORAGE_KEY,
	DAEMON_URL_STORAGE_KEY,
	dispatchPendingDaemonHandoff,
	parsePendingDaemonHandoffEvent,
	PENDING_DAEMON_HANDOFF_EVENT,
	parsePendingDaemonHandoff,
	PENDING_DAEMON_HANDOFF_STORAGE_KEY,
	readPendingDaemonHandoff,
	stageDaemonHandoff
} from './daemon-handoff';

function createStorage(): Pick<Storage, 'setItem' | 'removeItem'> {
	return { setItem: vi.fn(), removeItem: vi.fn() };
}

describe('consumeDaemonHandoff', () => {
	it('stores a fragment handoff and removes credentials from the URL', () => {
		const storage = createStorage();
		const replaceUrl = vi.fn();
		const connection = consumeDaemonHandoff(
			'https://chump.yaqeen.me/auth?redirectTo=%2Fc#daemonUrl=http%3A%2F%2F127.0.0.1%3A9417&daemonToken=secret-token',
			storage,
			replaceUrl
		);

		expect(connection).toEqual({ url: 'http://127.0.0.1:9417', token: 'secret-token' });
		expect(storage.setItem).toHaveBeenCalledWith(
			DAEMON_URL_STORAGE_KEY,
			'http://127.0.0.1:9417'
		);
		expect(storage.setItem).toHaveBeenCalledWith(DAEMON_TOKEN_STORAGE_KEY, 'secret-token');
		expect(replaceUrl).toHaveBeenCalledWith(
			'https://chump.yaqeen.me/auth?redirectTo=%2Fc'
		);
	});

	it('supports legacy query handoffs while preserving unrelated URL state', () => {
		const storage = createStorage();
		const replaceUrl = vi.fn();
		consumeDaemonHandoff(
			'https://chump.yaqeen.me/c?theme=dark&daemonUrl=http%3A%2F%2Flocalhost%3A9417&daemonToken=token#panel=chat',
			storage,
			replaceUrl
		);

		expect(replaceUrl).toHaveBeenCalledWith('https://chump.yaqeen.me/c?theme=dark#panel=chat');
	});

	it('scrubs an incomplete handoff without storing it', () => {
		const storage = createStorage();
		const replaceUrl = vi.fn();
		const connection = consumeDaemonHandoff(
			'https://chump.yaqeen.me/auth#daemonToken=secret-token',
			storage,
			replaceUrl
		);

		expect(connection).toBeNull();
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(replaceUrl).toHaveBeenCalledWith('https://chump.yaqeen.me/auth');
	});
});

describe('pending daemon handoff', () => {
	function createPendingStorage(): Storage {
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

	it('makes a fresh handoff available to another tab', () => {
		const localStorage = createPendingStorage();
		const connection = { url: 'http://127.0.0.1:9417', token: 'secret-token' };

		stageDaemonHandoff(localStorage, connection, 1_000);

		expect(readPendingDaemonHandoff(localStorage, 2_000)).toEqual(connection);
		expect(localStorage.getItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY)).not.toBeNull();
	});

	it('parses the storage event value without racing another tab', () => {
		const serialized = JSON.stringify({
			url: 'http://127.0.0.1:9417',
			token: 'secret-token',
			capturedAt: 1_000
		});

		expect(parsePendingDaemonHandoff(serialized, 2_000)).toEqual({
			url: 'http://127.0.0.1:9417',
			token: 'secret-token'
		});
	});

	it('notifies the current document without relying on a storage event', () => {
		const connection = { url: 'http://127.0.0.1:9417', token: 'secret-token' };
		const dispatchedEvents: Event[] = [];

		dispatchPendingDaemonHandoff(
			{
				dispatchEvent(event) {
					dispatchedEvents.push(event);
					return true;
				}
			},
			connection
		);

		const dispatched = dispatchedEvents[0];
		expect(dispatched).toBeDefined();
		if (!dispatched) throw new Error('expected a current-document handoff event');
		expect(dispatched.type).toBe(PENDING_DAEMON_HANDOFF_EVENT);
		expect(parsePendingDaemonHandoffEvent(dispatched)).toEqual(connection);
	});

	it('rejects malformed current-document handoffs', () => {
		const event = new CustomEvent(PENDING_DAEMON_HANDOFF_EVENT, {
			detail: { url: '', token: 'secret-token' }
		});

		expect(parsePendingDaemonHandoffEvent(event)).toBeNull();
	});

	it('rejects and removes an expired handoff', () => {
		const localStorage = createPendingStorage();
		stageDaemonHandoff(localStorage, { url: 'http://127.0.0.1:9417', token: 'secret-token' }, 1);

		expect(readPendingDaemonHandoff(localStorage, 2 * 60 * 1000 + 2)).toBeNull();
		expect(localStorage.getItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY)).toBeNull();
	});

	it('clears the pending handoff after a successful connection', () => {
		const localStorage = createPendingStorage();
		stageDaemonHandoff(localStorage, { url: 'http://127.0.0.1:9417', token: 'secret-token' });

		clearPendingDaemonHandoff(localStorage);

		expect(localStorage.getItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY)).toBeNull();
	});
});
