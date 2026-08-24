import type { LocalServiceConnection } from './local-service-api';

export const LOCAL_SERVICE_URL_STORAGE_KEY = 'chump:service-url';
export const LOCAL_SERVICE_TOKEN_STORAGE_KEY = 'chump:service-token';
export const LOCAL_SERVICE_USER_STORAGE_KEY = 'chump:service-user-id';
export const PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY = 'chump:pending-service-handoff';
export const PENDING_LOCAL_SERVICE_HANDOFF_EVENT = 'chump:pending-service-handoff';

const PENDING_LOCAL_SERVICE_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;
const SERVICE_URL_PARAM_KEY = 'serviceUrl';
const SERVICE_TOKEN_PARAM_KEY = 'serviceToken';
const PROJECT_ID_PARAM_KEY = 'projectId';

type HandoffStorage = Pick<Storage, 'setItem' | 'removeItem'>;
type PendingHandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type PendingLocalServiceHandoff = LocalServiceConnection & {
	capturedAt: number;
};

export type LocalServiceLaunchTarget = {
	url: string;
	connection: LocalServiceConnection | null;
};

export function consumeLocalServiceHandoff(
	href: string,
	storage: HandoffStorage,
	replaceUrl: (url: string) => void
): LocalServiceConnection | null {
	const url = new URL(href);
	const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
	const serviceUrl = hashParams.get(SERVICE_URL_PARAM_KEY) ?? url.searchParams.get(SERVICE_URL_PARAM_KEY);
	const serviceToken = hashParams.get(SERVICE_TOKEN_PARAM_KEY) ?? url.searchParams.get(SERVICE_TOKEN_PARAM_KEY);
	const projectId = hashParams.get(PROJECT_ID_PARAM_KEY) ?? url.searchParams.get(PROJECT_ID_PARAM_KEY);
	const hasHandoffParams =
		hashParams.has(SERVICE_URL_PARAM_KEY) ||
		hashParams.has(SERVICE_TOKEN_PARAM_KEY) ||
		hashParams.has(PROJECT_ID_PARAM_KEY) ||
		url.searchParams.has(SERVICE_URL_PARAM_KEY) ||
		url.searchParams.has(SERVICE_TOKEN_PARAM_KEY) ||
		url.searchParams.has(PROJECT_ID_PARAM_KEY);

	if (!hasHandoffParams) return null;

	hashParams.delete(SERVICE_URL_PARAM_KEY);
	hashParams.delete(SERVICE_TOKEN_PARAM_KEY);
	hashParams.delete(PROJECT_ID_PARAM_KEY);
	url.searchParams.delete(SERVICE_URL_PARAM_KEY);
	url.searchParams.delete(SERVICE_TOKEN_PARAM_KEY);
	url.searchParams.delete(PROJECT_ID_PARAM_KEY);
	url.hash = hashParams.size > 0 ? hashParams.toString() : '';
	replaceUrl(url.toString());

	if (!serviceUrl || !serviceToken) return null;

	const connection = { url: serviceUrl, token: serviceToken, ...(projectId ? { projectId } : {}) };
	storage.setItem(LOCAL_SERVICE_URL_STORAGE_KEY, connection.url);
	storage.setItem(LOCAL_SERVICE_TOKEN_STORAGE_KEY, connection.token);
	storage.removeItem(LOCAL_SERVICE_USER_STORAGE_KEY);
	return connection;
}

export function prepareLocalServiceLaunchTarget(
	targetURL: string,
	currentOrigin: string,
	storage: HandoffStorage
): LocalServiceLaunchTarget | null {
	let target: URL;
	try {
		target = new URL(targetURL);
	} catch {
		return null;
	}
	if (target.origin !== currentOrigin) return null;

	let sanitizedUrl = target.toString();
	const connection = consumeLocalServiceHandoff(target.toString(), storage, (url) => {
		sanitizedUrl = url;
	});
	return { url: sanitizedUrl, connection };
}

export function stageLocalServiceHandoff(
	storage: Pick<Storage, 'setItem'>,
	connection: LocalServiceConnection,
	capturedAt = Date.now()
): void {
	const pending: PendingLocalServiceHandoff = { ...connection, capturedAt };
	storage.setItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY, JSON.stringify(pending));
}

export function dispatchPendingLocalServiceHandoff(
	target: Pick<EventTarget, 'dispatchEvent'>,
	connection: LocalServiceConnection
): void {
	target.dispatchEvent(
		new CustomEvent<LocalServiceConnection>(PENDING_LOCAL_SERVICE_HANDOFF_EVENT, {
			detail: connection
		})
	);
}

export function parsePendingLocalServiceHandoffEvent(
	event: Event
): LocalServiceConnection | null {
	if (event.type !== PENDING_LOCAL_SERVICE_HANDOFF_EVENT) {
		return null;
	}
	return parseLocalServiceConnection((event as CustomEvent<unknown>).detail);
}

export function readPendingLocalServiceHandoff(
	storage: PendingHandoffStorage,
	now = Date.now()
): LocalServiceConnection | null {
	const serialized = storage.getItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY);
	if (!serialized) return null;
	const connection = parsePendingLocalServiceHandoff(serialized, now);
	if (!connection) {
		storage.removeItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY);
		return null;
	}
	return connection;
}

export function parsePendingLocalServiceHandoff(
	serialized: string,
	now = Date.now()
): LocalServiceConnection | null {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		return null;
	}

	if (!isPendingLocalServiceHandoff(value)) return null;
	if (value.capturedAt > now || now - value.capturedAt > PENDING_LOCAL_SERVICE_HANDOFF_MAX_AGE_MS) {
		return null;
	}

	return { url: value.url, token: value.token, ...(value.projectId ? { projectId: value.projectId } : {}) };
}

export function clearPendingLocalServiceHandoff(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(PENDING_LOCAL_SERVICE_HANDOFF_STORAGE_KEY);
}

function isPendingLocalServiceHandoff(value: unknown): value is PendingLocalServiceHandoff {
	if (!value || typeof value !== 'object') return false;
	const pending = value as Record<string, unknown>;
	return (
		parseLocalServiceConnection(pending) !== null &&
		typeof pending.capturedAt === 'number' &&
		Number.isFinite(pending.capturedAt)
	);
}

function parseLocalServiceConnection(value: unknown): LocalServiceConnection | null {
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
	if (connection.projectId !== undefined && typeof connection.projectId !== 'string') {
		return null;
	}
	return {
		url: connection.url,
		token: connection.token,
		...(connection.projectId ? { projectId: connection.projectId } : {})
	};
}
