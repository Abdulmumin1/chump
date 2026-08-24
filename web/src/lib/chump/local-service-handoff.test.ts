import { describe, expect, it, vi } from 'vitest';
import {
	clearPendingLocalServiceHandoff,
	consumeLocalServiceHandoff,
	dispatchPendingLocalServiceHandoff,
	LOCAL_SERVICE_TOKEN_STORAGE_KEY,
	LOCAL_SERVICE_URL_STORAGE_KEY,
	parsePendingLocalServiceHandoff,
	parsePendingLocalServiceHandoffEvent,
	PENDING_LOCAL_SERVICE_HANDOFF_EVENT,
	PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY,
	prepareLocalServiceLaunchTarget,
	readPendingLocalServiceHandoff,
	stageLocalServiceHandoff
} from './local-service-handoff';

function createStorage(): Pick<Storage, 'setItem' | 'removeItem'> {
	return { setItem: vi.fn(), removeItem: vi.fn() };
}

describe('consumeLocalServiceHandoff', () => {
	it('stores a fragment handoff and removes credentials from the URL', () => {
		const storage = createStorage();
		const replaceUrl = vi.fn();
		const connection = consumeLocalServiceHandoff(
			'https://chmp.dev/auth?redirectTo=%2Fc#serviceUrl=http%3A%2F%2F127.0.0.1%3A9417&serviceToken=secret-token&projectId=project-one',
			storage,
			replaceUrl
		);

		expect(connection).toEqual({
			url: 'http://127.0.0.1:9417',
			token: 'secret-token',
			projectId: 'project-one'
		});
		expect(storage.setItem).toHaveBeenCalledWith(
			LOCAL_SERVICE_URL_STORAGE_KEY,
			'http://127.0.0.1:9417'
		);
		expect(storage.setItem).toHaveBeenCalledWith(LOCAL_SERVICE_TOKEN_STORAGE_KEY, 'secret-token');
		expect(replaceUrl).toHaveBeenCalledWith('https://chmp.dev/auth?redirectTo=%2Fc');
	});

	it('scrubs an incomplete handoff without storing it', () => {
		const storage = createStorage();
		const replaceUrl = vi.fn();
		const connection = consumeLocalServiceHandoff(
			'https://chmp.dev/auth#serviceToken=secret-token',
			storage,
			replaceUrl
		);

		expect(connection).toBeNull();
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(replaceUrl).toHaveBeenCalledWith('https://chmp.dev/auth');
	});
});

describe('prepareLocalServiceLaunchTarget', () => {
	it('extracts a handoff and returns a credential-free navigation URL', () => {
		const storage = createStorage();
		const target = prepareLocalServiceLaunchTarget(
			'https://chmp.dev/c#serviceUrl=http%3A%2F%2F127.0.0.1%3A9417&serviceToken=secret-token&projectId=project-one',
			'https://chmp.dev',
			storage
		);

		expect(target).toEqual({
			url: 'https://chmp.dev/c',
			connection: {
				url: 'http://127.0.0.1:9417',
				token: 'secret-token',
				projectId: 'project-one'
			}
		});
	});

	it('preserves same-origin launch targets without handoff credentials', () => {
		const target = prepareLocalServiceLaunchTarget(
			'https://chmp.dev/account?tab=profile',
			'https://chmp.dev',
			createStorage()
		);

		expect(target).toEqual({
			url: 'https://chmp.dev/account?tab=profile',
			connection: null
		});
	});

	it('rejects malformed and cross-origin launch targets', () => {
		const storage = createStorage();

		expect(prepareLocalServiceLaunchTarget('not a URL', 'https://chmp.dev', storage)).toBeNull();
		expect(
			prepareLocalServiceLaunchTarget(
				'https://example.com/c#serviceUrl=http://127.0.0.1:9417&serviceToken=secret-token',
				'https://chmp.dev',
				storage
			)
		).toBeNull();
	});
});

describe('pending local service handoff', () => {
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

		stageLocalServiceHandoff(localStorage, connection, 1_000);

		expect(readPendingLocalServiceHandoff(localStorage, 2_000)).toEqual(connection);
		expect(localStorage.getItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY)).not.toBeNull();
	});

	it('parses the storage event value without racing another tab', () => {
		const serialized = JSON.stringify({
			url: 'http://127.0.0.1:9417',
			token: 'secret-token',
			capturedAt: 1_000
		});

		expect(parsePendingLocalServiceHandoff(serialized, 2_000)).toEqual({
			url: 'http://127.0.0.1:9417',
			token: 'secret-token'
		});
	});

	it('notifies the current document without relying on a storage event', () => {
		const connection = { url: 'http://127.0.0.1:9417', token: 'secret-token' };
		const dispatchedEvents: Event[] = [];

		dispatchPendingLocalServiceHandoff(
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
		expect(dispatched.type).toBe(PENDING_LOCAL_SERVICE_HANDOFF_EVENT);
		expect(parsePendingLocalServiceHandoffEvent(dispatched)).toEqual(connection);
	});

	it('rejects malformed current-document handoffs', () => {
		const event = new CustomEvent(PENDING_LOCAL_SERVICE_HANDOFF_EVENT, {
			detail: { url: '', token: 'secret-token' }
		});

		expect(parsePendingLocalServiceHandoffEvent(event)).toBeNull();
	});

	it('rejects and removes an expired handoff', () => {
		const localStorage = createPendingStorage();
		stageLocalServiceHandoff(localStorage, { url: 'http://127.0.0.1:9417', token: 'secret-token' }, 1);

		expect(readPendingLocalServiceHandoff(localStorage, 2 * 60 * 1000 + 2)).toBeNull();
		expect(localStorage.getItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY)).toBeNull();
	});

	it('clears the pending handoff after a successful connection', () => {
		const localStorage = createPendingStorage();
		stageLocalServiceHandoff(localStorage, { url: 'http://127.0.0.1:9417', token: 'secret-token' });

		clearPendingLocalServiceHandoff(localStorage);

		expect(localStorage.getItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY)).toBeNull();
	});
});
