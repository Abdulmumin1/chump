import type { DaemonConnection } from './daemon-api';
import {
	DAEMON_TOKEN_STORAGE_KEY,
	DAEMON_URL_STORAGE_KEY,
	DAEMON_USER_STORAGE_KEY
} from './daemon-handoff';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function readDaemonConnection(
	userId: string,
	transientStorage: ReadableStorage,
	persistentStorage: ReadableStorage
): DaemonConnection | null {
	const transientOwner = transientStorage.getItem(DAEMON_USER_STORAGE_KEY);
	if (!transientOwner || transientOwner === userId) {
		const transient = readConnection(
			transientStorage,
			DAEMON_URL_STORAGE_KEY,
			DAEMON_TOKEN_STORAGE_KEY
		);
		if (transient) return transient;
	}

	return readConnection(
		persistentStorage,
		persistentConnectionKey(userId, 'url'),
		persistentConnectionKey(userId, 'token')
	);
}

export function rememberDaemonConnection(
	userId: string,
	connection: DaemonConnection,
	transientStorage: WritableStorage,
	persistentStorage: WritableStorage
): void {
	transientStorage.setItem(DAEMON_URL_STORAGE_KEY, connection.url);
	transientStorage.setItem(DAEMON_TOKEN_STORAGE_KEY, connection.token);
	transientStorage.setItem(DAEMON_USER_STORAGE_KEY, userId);
	persistentStorage.setItem(persistentConnectionKey(userId, 'url'), connection.url);
	persistentStorage.setItem(persistentConnectionKey(userId, 'token'), connection.token);
}

export function forgetDaemonConnection(
	userId: string,
	transientStorage: WritableStorage,
	persistentStorage: WritableStorage
): void {
	transientStorage.removeItem(DAEMON_URL_STORAGE_KEY);
	transientStorage.removeItem(DAEMON_TOKEN_STORAGE_KEY);
	transientStorage.removeItem(DAEMON_USER_STORAGE_KEY);
	persistentStorage.removeItem(persistentConnectionKey(userId, 'url'));
	persistentStorage.removeItem(persistentConnectionKey(userId, 'token'));
}

function readConnection(
	storage: ReadableStorage,
	urlKey: string,
	tokenKey: string
): DaemonConnection | null {
	const url = storage.getItem(urlKey);
	const token = storage.getItem(tokenKey);
	return url && token ? { url, token } : null;
}

function persistentConnectionKey(userId: string, field: 'url' | 'token'): string {
	if (!userId) throw new Error('A user ID is required to access a saved daemon connection');
	return `chump:user:${userId}:daemon-${field}`;
}
