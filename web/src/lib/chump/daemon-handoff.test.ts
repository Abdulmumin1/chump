import { describe, expect, it, vi } from 'vitest';
import {
	consumeDaemonHandoff,
	DAEMON_TOKEN_STORAGE_KEY,
	DAEMON_URL_STORAGE_KEY
} from './daemon-handoff';

function createStorage(): Pick<Storage, 'setItem'> {
	return { setItem: vi.fn() };
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
