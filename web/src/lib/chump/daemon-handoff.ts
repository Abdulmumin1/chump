import type { DaemonConnection } from './daemon-api';

export const DAEMON_URL_STORAGE_KEY = 'chump:daemon-url';
export const DAEMON_TOKEN_STORAGE_KEY = 'chump:daemon-token';
export const DAEMON_USER_STORAGE_KEY = 'chump:daemon-user-id';

type HandoffStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function consumeDaemonHandoff(
	href: string,
	storage: HandoffStorage,
	replaceUrl: (url: string) => void
): DaemonConnection | null {
	const url = new URL(href);
	const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
	const daemonUrl = hashParams.get('daemonUrl') ?? url.searchParams.get('daemonUrl');
	const daemonToken = hashParams.get('daemonToken') ?? url.searchParams.get('daemonToken');
	const hasHandoffParams =
		hashParams.has('daemonUrl') ||
		hashParams.has('daemonToken') ||
		url.searchParams.has('daemonUrl') ||
		url.searchParams.has('daemonToken');

	if (!hasHandoffParams) return null;

	hashParams.delete('daemonUrl');
	hashParams.delete('daemonToken');
	url.searchParams.delete('daemonUrl');
	url.searchParams.delete('daemonToken');
	url.hash = hashParams.size > 0 ? hashParams.toString() : '';
	replaceUrl(url.toString());

	if (!daemonUrl || !daemonToken) return null;

	const connection = { url: daemonUrl, token: daemonToken };
	storage.setItem(DAEMON_URL_STORAGE_KEY, connection.url);
	storage.setItem(DAEMON_TOKEN_STORAGE_KEY, connection.token);
	storage.removeItem(DAEMON_USER_STORAGE_KEY);
	return connection;
}
