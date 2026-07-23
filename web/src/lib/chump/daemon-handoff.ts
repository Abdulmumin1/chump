import type { DaemonConnection } from './daemon-api';

export const DAEMON_URL_STORAGE_KEY = 'chump:daemon-url';
export const DAEMON_TOKEN_STORAGE_KEY = 'chump:daemon-token';
export const DAEMON_USER_STORAGE_KEY = 'chump:daemon-user-id';
export const PENDING_DAEMON_HANDOFF_STORAGE_KEY = 'chump:pending-daemon-handoff';
export const PENDING_DAEMON_HANDOFF_EVENT = 'chump:pending-daemon-handoff';

const PENDING_DAEMON_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;

type HandoffStorage = Pick<Storage, 'setItem' | 'removeItem'>;
type PendingHandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type PendingDaemonHandoff = DaemonConnection & {
	capturedAt: number;
};

export type DaemonLaunchTarget = {
	url: string;
	connection: DaemonConnection | null;
};

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

export function prepareDaemonLaunchTarget(
	targetURL: string,
	currentOrigin: string,
	storage: HandoffStorage
): DaemonLaunchTarget | null {
	let target: URL;
	try {
		target = new URL(targetURL);
	} catch {
		return null;
	}
	if (target.origin !== currentOrigin) return null;

	let sanitizedUrl = target.toString();
	const connection = consumeDaemonHandoff(target.toString(), storage, (url) => {
		sanitizedUrl = url;
	});
	return { url: sanitizedUrl, connection };
}

export function stageDaemonHandoff(
	storage: Pick<Storage, 'setItem'>,
	connection: DaemonConnection,
	capturedAt = Date.now()
): void {
	const pending: PendingDaemonHandoff = { ...connection, capturedAt };
	storage.setItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY, JSON.stringify(pending));
}

export function dispatchPendingDaemonHandoff(
	target: Pick<EventTarget, 'dispatchEvent'>,
	connection: DaemonConnection
): void {
	target.dispatchEvent(
		new CustomEvent<DaemonConnection>(PENDING_DAEMON_HANDOFF_EVENT, {
			detail: connection
		})
	);
}

export function parsePendingDaemonHandoffEvent(event: Event): DaemonConnection | null {
	if (event.type !== PENDING_DAEMON_HANDOFF_EVENT) return null;
	return parseDaemonConnection((event as CustomEvent<unknown>).detail);
}

export function readPendingDaemonHandoff(
	storage: PendingHandoffStorage,
	now = Date.now()
): DaemonConnection | null {
	const serialized = storage.getItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY);
	if (!serialized) return null;

	const connection = parsePendingDaemonHandoff(serialized, now);
	if (!connection) storage.removeItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY);
	return connection;
}

export function parsePendingDaemonHandoff(
	serialized: string,
	now = Date.now()
): DaemonConnection | null {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		return null;
	}

	if (!isPendingDaemonHandoff(value)) return null;
	if (value.capturedAt > now || now - value.capturedAt > PENDING_DAEMON_HANDOFF_MAX_AGE_MS) {
		return null;
	}

	return { url: value.url, token: value.token };
}

export function clearPendingDaemonHandoff(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(PENDING_DAEMON_HANDOFF_STORAGE_KEY);
}

function isPendingDaemonHandoff(value: unknown): value is PendingDaemonHandoff {
	if (!value || typeof value !== 'object') return false;
	const pending = value as Record<string, unknown>;
	return (
		parseDaemonConnection(pending) !== null &&
		typeof pending.capturedAt === 'number' &&
		Number.isFinite(pending.capturedAt)
	);
}

function parseDaemonConnection(value: unknown): DaemonConnection | null {
	if (!value || typeof value !== 'object') return null;
	const connection = value as Record<string, unknown>;
	if (
		typeof connection.url !== 'string' ||
		connection.url.length === 0 ||
		typeof connection.token !== 'string' ||
		connection.token.length === 0
	) {
		return null;
	}
	return { url: connection.url, token: connection.token };
}
