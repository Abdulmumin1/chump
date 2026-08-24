import type { LocalServiceConnection } from './local-service-api';
import {
	LOCAL_SERVICE_TOKEN_STORAGE_KEY,
	LOCAL_SERVICE_URL_STORAGE_KEY,
	LOCAL_SERVICE_USER_STORAGE_KEY
} from './local-service-handoff';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function readLocalServiceConnection(
	userId: string,
	transientStorage: ReadableStorage,
	persistentStorage: ReadableStorage
): LocalServiceConnection | null {
	const transientOwner = transientStorage.getItem(LOCAL_SERVICE_USER_STORAGE_KEY);
	if (!transientOwner || transientOwner === userId) {
		const transient = readConnection(
			transientStorage,
			LOCAL_SERVICE_URL_STORAGE_KEY,
			LOCAL_SERVICE_TOKEN_STORAGE_KEY
		);
		if (transient) return transient;
	}

	return readConnection(
		persistentStorage,
		persistentConnectionKey(userId, 'url'),
		persistentConnectionKey(userId, 'token')
	);
}

export function rememberLocalServiceConnection(
	userId: string,
	connection: LocalServiceConnection,
	transientStorage: WritableStorage,
	persistentStorage: WritableStorage
): void {
	transientStorage.setItem(LOCAL_SERVICE_URL_STORAGE_KEY, connection.url);
	transientStorage.setItem(LOCAL_SERVICE_TOKEN_STORAGE_KEY, connection.token);
	transientStorage.setItem(LOCAL_SERVICE_USER_STORAGE_KEY, userId);
	persistentStorage.setItem(persistentConnectionKey(userId, 'url'), connection.url);
	persistentStorage.setItem(persistentConnectionKey(userId, 'token'), connection.token);
}

export function forgetLocalServiceConnection(
	userId: string,
	transientStorage: WritableStorage,
	persistentStorage: WritableStorage
): void {
	transientStorage.removeItem(LOCAL_SERVICE_URL_STORAGE_KEY);
	transientStorage.removeItem(LOCAL_SERVICE_TOKEN_STORAGE_KEY);
	transientStorage.removeItem(LOCAL_SERVICE_USER_STORAGE_KEY);
	persistentStorage.removeItem(persistentConnectionKey(userId, 'url'));
	persistentStorage.removeItem(persistentConnectionKey(userId, 'token'));
}

function readConnection(
	storage: ReadableStorage,
	urlKey: string,
	tokenKey: string
): LocalServiceConnection | null {
	const url = storage.getItem(urlKey)?.trim();
	const token = storage.getItem(tokenKey)?.trim();
	if (!url || !token) {
		return null;
	}
	return { url, token };
}

function persistentConnectionKey(userId: string, field: 'url' | 'token'): string {
	if (!userId) throw new Error('A user ID is required to access a saved local service connection');
	return `chump:user:${userId}:service-${field}`;
}
