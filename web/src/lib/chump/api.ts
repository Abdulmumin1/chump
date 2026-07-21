import type {
	ChatAttachment,
	AgentEventLogResponse,
	AgentMessagesResponse,
	AgentStateResponse,
	ChumpState,
	ChumpHealth,
	ChumpStatus,
	CompactionResult,
	SessionSummary,
	SessionsResponse,
	SseEvent
} from '$lib/chump/types';
import type { FileSearchResult } from '$lib/chump/types';

export type ChumpApiTarget =
	| { kind: 'direct'; serverUrl: string }
	| { kind: 'daemon'; daemonUrl: string; token: string; projectId: string };

export function normalizeServerUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function createSessionId(workspaceRoot: string): string {
	const workspaceName = sanitizeSegment(workspaceRoot.split('/').filter(Boolean).at(-1) ?? 'workspace');
	const stamp = Date.now().toString(36);
	const suffix = crypto.randomUUID().slice(0, 8);
	return `${workspaceName}-${stamp}-${suffix}`;
}

export async function getHealth(target: ChumpApiTarget): Promise<ChumpHealth> {
	return await fetchJson<ChumpHealth>(projectUrl(target, 'health'), requestHeaders(target));
}

export async function getSessions(
	target: ChumpApiTarget,
	options: { page?: number; limit?: number } = {}
): Promise<SessionsResponse> {
	const url = new URL(projectUrl(target, 'sessions'));
	url.searchParams.set('page', String(options.page ?? 1));
	url.searchParams.set('limit', String(options.limit ?? 15));
	const response = await fetchJson<Partial<SessionsResponse> & Pick<SessionsResponse, 'sessions'>>(
		url.toString(),
		requestHeaders(target)
	);
	const page = response.page ?? 1;
	const pageSize = response.page_size ?? response.sessions.length;
	const total = response.total ?? response.sessions.length;
	return {
		sessions: response.sessions,
		page,
		page_size: pageSize,
		total,
		total_pages: response.total_pages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
	};
}

export async function getStatus(target: ChumpApiTarget, agentId: string): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(target, agentId, 'status');
}

export async function getState(target: ChumpApiTarget, agentId: string): Promise<ChumpState> {
	const response = await fetchJson<AgentStateResponse>(`${buildAgentUrl(target, agentId)}/state`, requestHeaders(target));
	return normalizeStateResponse(response);
}

export async function getMessages(target: ChumpApiTarget, agentId: string): Promise<AgentMessagesResponse> {
	return await fetchJson<AgentMessagesResponse>(`${buildAgentUrl(target, agentId)}/messages`, requestHeaders(target));
}

export async function getEventLog(target: ChumpApiTarget, agentId: string): Promise<AgentEventLogResponse> {
	return await invokeAction<AgentEventLogResponse>(target, agentId, 'event_log');
}

export async function setModel(
	target: ChumpApiTarget,
	agentId: string,
	provider: string,
	model: string
): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(target, agentId, 'set_model', { provider, model });
}

export async function setReasoning(
	target: ChumpApiTarget,
	agentId: string,
	mode: string
): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(target, agentId, 'set_reasoning', { mode });
}

export async function loadSkill(
	target: ChumpApiTarget,
	agentId: string,
	name: string,
	args = ''
): Promise<{ name: string; prompt: string }> {
	return await invokeAction<{ name: string; prompt: string }>(target, agentId, 'load_skill', { name, args });
}

export async function searchFiles(
	target: ChumpApiTarget,
	query: string,
	limit = 20
): Promise<FileSearchResult[]> {
	const url = new URL(projectUrl(target, 'files'));
	url.searchParams.set('query', query);
	url.searchParams.set('limit', String(limit));
	const result = await fetchJson<{ files: FileSearchResult[] }>(url.toString(), requestHeaders(target));
	return result.files;
}

export async function clearMessages(
	target: ChumpApiTarget,
	agentId: string
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(target, agentId, 'clear_messages');
}

export async function compactMessages(
	target: ChumpApiTarget,
	agentId: string
): Promise<CompactionResult> {
	return await invokeAction<CompactionResult>(target, agentId, 'compact');
}

export async function abortCurrentTurn(
	target: ChumpApiTarget,
	agentId: string
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(target, agentId, 'abort_current_turn');
}

export async function steerCurrentTurn(
	target: ChumpApiTarget,
	agentId: string,
	message: string,
	attachments: ChatAttachment[] = [],
	displayMessage?: string,
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(target, agentId, 'steer_current_turn', {
		message,
		attachments,
		...(displayMessage ? { display_message: displayMessage } : {})
	});
}

export async function cancelSteering(
	target: ChumpApiTarget,
	agentId: string,
	index: number
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(target, agentId, 'cancel_steering', { index });
}

export async function streamChat(
	target: ChumpApiTarget,
	agentId: string,
	message: string,
	attachments: ChatAttachment[] = [],
	signal?: AbortSignal,
	displayMessage?: string,
): Promise<string> {
	const response = await fetch(`${buildAgentUrl(target, agentId)}/chat?stream=true`, {
		method: 'POST',
		signal,
		headers: {
			...requestHeaders(target),
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			message,
			attachments,
			...(displayMessage ? { display_message: displayMessage } : {})
		})
	});

	if (!response.ok) {
		throw new Error(await readErrorResponse(response));
	}

	let finalText = '';
	let streamError: string | null = null;
	let receivedEndEvent = false;
	await consumeSse(response, (event) => {
		if (event.event === 'end') {
			receivedEndEvent = true;
			finalText = safeParseString(event.data);
		}
		if (event.event === 'error') {
			streamError = safeParseError(event.data) || 'chat failed';
		}
	});

	if (streamError) {
		throw new Error(streamError);
	}

	if (!receivedEndEvent && (!signal || !signal.aborted)) {
		throw new Error('Connection closed abruptly during streaming');
	}

	return finalText;
}

export function openEventStream(
	target: ChumpApiTarget,
	agentId: string,
	handlers: {
		onEvent: (event: SseEvent) => void | Promise<void>;
		onError?: (error: Error) => void;
	},
	options: {
		lastEventId?: number;
		reconnectDelayMs?: number;
		idleTimeoutMs?: number;
	} = {}
): () => void {
	const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
	// Server sends `: keepalive` comments every 30s. If we go ~60s without any
	// bytes (proxy silently dropped the socket, browser paused us, sleeping
	// laptop, etc.), tear the connection down and reconnect.
	const idleTimeoutMs = options.idleTimeoutMs ?? 60000;
	let closed = false;
	let lastEventId = normalizeEventId(options.lastEventId) ?? 0;
	let controller: AbortController | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	const clientId = eventStreamClientId();

	const armIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
		}
		idleTimer = setTimeout(() => {
			controller?.abort();
		}, idleTimeoutMs);
	};

	const clearIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	};

	const forceReconnect = () => {
		controller?.abort();
	};

	const onVisibilityChange = () => {
		if (typeof document !== 'undefined' && !document.hidden) {
			forceReconnect();
		}
	};

	const onOnline = () => {
		forceReconnect();
	};

	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibilityChange);
	}
	if (typeof window !== 'undefined') {
		window.addEventListener('online', onOnline);
	}

	const connect = async (): Promise<void> => {
		while (!closed) {
			controller = new AbortController();
			armIdleTimer();
			try {
				const requestUrl = new URL(`${buildAgentUrl(target, agentId)}/events`);
				requestUrl.searchParams.set('client_id', clientId);
				if (lastEventId > 0) {
					requestUrl.searchParams.set('last_event_id', String(lastEventId));
				}

				const response = await fetch(requestUrl, {
					signal: controller.signal,
					headers: {
						...requestHeaders(target),
						accept: 'text/event-stream'
					}
				});

				if (!response.ok) {
					throw new Error(`event stream failed with ${response.status}`);
				}

				await consumeSse(
					response,
					async (event) => {
						const eventId = normalizeEventId(event.id);
						if (eventId !== null && eventId <= lastEventId) {
							return;
						}
						await handlers.onEvent(event);
						if (eventId !== null) {
							lastEventId = eventId;
						}
					},
					armIdleTimer
				);
			} catch (error) {
				if (closed) {
					break;
				}
				// Aborted = deliberate (close, idle watchdog, visibility, online); fall through to reconnect.
				if (!controller.signal.aborted) {
					handlers.onError?.(error instanceof Error ? error : new Error(errorMessage(error)));
				}
			} finally {
				clearIdleTimer();
			}

			if (closed) {
				break;
			}

			await delay(reconnectDelayMs);
		}
	};

	void connect();

	return () => {
		closed = true;
		clearIdleTimer();
		controller?.abort();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', onVisibilityChange);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', onOnline);
		}
	};
}

function eventStreamClientId(): string {
	if (typeof sessionStorage !== 'undefined') {
		const key = 'chump:event-stream-client-id';
		const existing = sessionStorage.getItem(key);
		if (existing) {
			return existing;
		}
		const next = `web-${crypto.randomUUID()}`;
		sessionStorage.setItem(key, next);
		return next;
	}
	return `web-${crypto.randomUUID()}`;
}

export function sessionTitle(session: SessionSummary): string {
	const fallback = session.last_user_goal?.trim() || session.id;
	return clip(session.title?.trim() || fallback, 72);
}

export async function consumeSse(
	response: Response,
	onEvent: (event: SseEvent) => void | Promise<void>,
	onActivity?: () => void
): Promise<void> {
	if (!response.body) {
		throw new Error('response body is not readable');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		// Fired for every chunk including `: keepalive` comments — used by
		// callers to reset idle/heartbeat watchdogs.
		onActivity?.();

		buffer += decoder.decode(value, { stream: true });
		let boundary = buffer.indexOf('\n\n');

		while (boundary !== -1) {
			const rawEvent = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);

			const parsed = parseSseEvent(rawEvent);
			if (parsed) {
				await onEvent(parsed);
			}

			boundary = buffer.indexOf('\n\n');
		}
	}
}

function normalizeEventId(value: string | number | undefined): number | null {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function invokeAction<T>(
	target: ChumpApiTarget,
	agentId: string,
	actionName: string,
	body: Record<string, unknown> = {}
): Promise<T> {
	const response = await fetch(`${buildAgentUrl(target, agentId)}/action/${actionName}`, {
		method: 'POST',
		headers: {
			...requestHeaders(target),
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		throw new Error(await readErrorResponse(response));
	}

	const data = (await response.json()) as { result?: T; error?: unknown };
	if (!response.ok || data.error) {
		throw new Error(data.error ? errorMessage(data.error) : `action failed with ${response.status}`);
	}

	if (data.result === undefined) {
		throw new Error('action response missing result');
	}

	return data.result;
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(await readErrorResponse(response));
	}
	return (await response.json()) as T;
}

function normalizeStateResponse(response: AgentStateResponse): ChumpState {
	if (response && typeof response === 'object' && 'state' in response) {
		return response.state;
	}
	return response as ChumpState;
}

function projectUrl(target: ChumpApiTarget, path: string): string {
	if (target.kind === 'direct') {
		return `${normalizeServerUrl(target.serverUrl)}/${path}`;
	}
	return `${normalizeServerUrl(target.daemonUrl)}/projects/${encodeURIComponent(target.projectId)}/${path}`;
}

function buildAgentUrl(target: ChumpApiTarget, agentId: string): string {
	if (target.kind === 'direct') {
		return `${normalizeServerUrl(target.serverUrl)}/agent/${encodeURIComponent(agentId)}`;
	}
	return `${normalizeServerUrl(target.daemonUrl)}/projects/${encodeURIComponent(target.projectId)}/sessions/${encodeURIComponent(agentId)}`;
}

function requestHeaders(target: ChumpApiTarget): Record<string, string> {
	return target.kind === 'daemon'
		? { authorization: `Bearer ${target.token}` }
		: {};
}

async function readErrorResponse(response: Response): Promise<string> {
	const body = (await response.text()).trim();
	if (body) {
		return errorMessageFromString(body);
	}
	return `request failed with ${response.status}`;
}

function parseSseEvent(rawEvent: string): SseEvent | null {
	const lines = rawEvent.split(/\r?\n/).filter((line) => line.length > 0 && !line.startsWith(':'));
	if (lines.length === 0) {
		return null;
	}

	let event = 'message';
	let id: string | undefined;
	const dataLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith('event:')) {
			event = line.slice(6).trim();
			continue;
		}
		if (line.startsWith('id:')) {
			id = line.slice(3).trim();
			continue;
		}
		if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trimStart());
		}
	}

	return {
		event,
		data: dataLines.join('\n'),
		id
	};
}

function safeParseString(value: string): string {
	try {
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === 'string' ? parsed : value;
	} catch {
		return value;
	}
}

function safeParseError(value: string): string {
	try {
		const parsed = JSON.parse(value) as unknown;
		return errorMessage(parsed);
	} catch {
		// Fall through to raw SSE data.
	}
	return value;
}

function errorMessage(value: unknown): string {
	const extracted = errorMessageValue(value);
	if (extracted) {
		return extracted;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function errorMessageValue(value: unknown): string | null {
	if (value instanceof Error) {
		return value.message.trim() || value.name;
	}
	if (typeof value === 'string') {
		return errorMessageFromString(value);
	}
	if (!value || typeof value !== 'object') {
		return null;
	}

	const record = value as Record<string, unknown>;
	for (const key of ['message', 'error', 'detail', 'details']) {
		if (!(key in record)) {
			continue;
		}
		const nested = errorMessageValue(record[key]);
		if (nested) {
			return nested;
		}
	}

	if (Array.isArray(record.errors)) {
		const messages = record.errors
			.map((item) => errorMessageValue(item))
			.filter((item): item is string => Boolean(item));
		if (messages.length > 0) {
			return messages.join('; ');
		}
	}

	return null;
}

function errorMessageFromString(value: string): string {
	const message = value.trim();
	if (!message.startsWith('{') || !message.endsWith('}')) {
		return message;
	}
	try {
		const parsed = JSON.parse(message) as unknown;
		return errorMessageValue(parsed) ?? message;
	} catch {
		return message;
	}
}

function sanitizeSegment(value: string): string {
	const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
	return normalized.replace(/^-+|-+$/g, '') || 'workspace';
}

function clip(value: string, size: number): string {
	if (value.length <= size) {
		return value;
	}
	return `${value.slice(0, size - 3).trimEnd()}...`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
