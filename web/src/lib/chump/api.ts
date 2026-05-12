import type {
	ChatAttachment,
	AgentEventLogResponse,
	AgentMessagesResponse,
	AgentStateResponse,
	ChumpHealth,
	ChumpStatus,
	SessionSummary,
	SessionsResponse,
	SseEvent
} from '$lib/chump/types';

export function normalizeServerUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function createSessionId(workspaceRoot: string): string {
	const workspaceName = sanitizeSegment(workspaceRoot.split('/').filter(Boolean).at(-1) ?? 'workspace');
	const stamp = Date.now().toString(36);
	const suffix = crypto.randomUUID().slice(0, 8);
	return `${workspaceName}-${stamp}-${suffix}`;
}

export async function getHealth(serverUrl: string): Promise<ChumpHealth> {
	return await fetchJson<ChumpHealth>(`${normalizeServerUrl(serverUrl)}/health`);
}

export async function getSessions(serverUrl: string): Promise<SessionsResponse> {
	return await fetchJson<SessionsResponse>(`${normalizeServerUrl(serverUrl)}/sessions`);
}

export async function getStatus(serverUrl: string, agentId: string): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(serverUrl, agentId, 'status');
}

export async function getState(serverUrl: string, agentId: string): Promise<AgentStateResponse> {
	return await fetchJson<AgentStateResponse>(`${buildAgentUrl(serverUrl, agentId)}/state`);
}

export async function getMessages(serverUrl: string, agentId: string): Promise<AgentMessagesResponse> {
	return await fetchJson<AgentMessagesResponse>(`${buildAgentUrl(serverUrl, agentId)}/messages`);
}

export async function getEventLog(serverUrl: string, agentId: string): Promise<AgentEventLogResponse> {
	return await invokeAction<AgentEventLogResponse>(serverUrl, agentId, 'event_log');
}

export async function setModel(
	serverUrl: string,
	agentId: string,
	provider: string,
	model: string
): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(serverUrl, agentId, 'set_model', { provider, model });
}

export async function setReasoning(
	serverUrl: string,
	agentId: string,
	mode: string
): Promise<ChumpStatus> {
	return await invokeAction<ChumpStatus>(serverUrl, agentId, 'set_reasoning', { mode });
}

export async function loadSkill(
	serverUrl: string,
	agentId: string,
	name: string,
	args = ''
): Promise<{ name: string; prompt: string }> {
	return await invokeAction<{ name: string; prompt: string }>(serverUrl, agentId, 'load_skill', { name, args });
}

export async function clearMessages(
	serverUrl: string,
	agentId: string
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(serverUrl, agentId, 'clear_messages');
}

export async function abortCurrentTurn(
	serverUrl: string,
	agentId: string
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(serverUrl, agentId, 'abort_current_turn');
}

export async function steerCurrentTurn(
	serverUrl: string,
	agentId: string,
	message: string,
	attachments: ChatAttachment[] = [],
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(serverUrl, agentId, 'steer_current_turn', { message, attachments });
}

export async function cancelSteering(
	serverUrl: string,
	agentId: string,
	index: number
): Promise<{ status: string }> {
	return await invokeAction<{ status: string }>(serverUrl, agentId, 'cancel_steering', { index });
}

export async function streamChat(
	serverUrl: string,
	agentId: string,
	message: string,
	attachments: ChatAttachment[] = [],
	signal?: AbortSignal,
): Promise<string> {
	const response = await fetch(`${buildAgentUrl(serverUrl, agentId)}/chat?stream=true`, {
		method: 'POST',
		signal,
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({ message, attachments })
	});

	if (!response.ok) {
		throw new Error(await readErrorResponse(response));
	}

	let finalText = '';
	let streamError: string | null = null;
	await consumeSse(response, (event) => {
		if (event.event === 'end') {
			finalText = safeParseString(event.data);
		}
		if (event.event === 'error') {
			streamError = safeParseString(event.data) || 'chat failed';
		}
	});

	if (streamError) {
		throw new Error(streamError);
	}

	return finalText;
}

export function openEventStream(
	serverUrl: string,
	agentId: string,
	handlers: {
		onEvent: (event: SseEvent) => void;
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
	let lastEventId = options.lastEventId ?? 0;
	let controller: AbortController | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
				const requestUrl = new URL(`${buildAgentUrl(serverUrl, agentId)}/events`);
				if (lastEventId > 0) {
					requestUrl.searchParams.set('last_event_id', String(lastEventId));
				}

				const response = await fetch(requestUrl, {
					signal: controller.signal,
					headers: {
						accept: 'text/event-stream'
					}
				});

				if (!response.ok) {
					throw new Error(`event stream failed with ${response.status}`);
				}

				await consumeSse(
					response,
					(event) => {
						if (event.id) {
							const parsed = Number(event.id);
							if (Number.isFinite(parsed)) {
								lastEventId = parsed;
							}
						}
						handlers.onEvent(event);
					},
					armIdleTimer
				);
			} catch (error) {
				if (closed) {
					break;
				}
				// Aborted = deliberate (close, idle watchdog, visibility, online); fall through to reconnect.
				if (!controller.signal.aborted) {
					handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
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

export function sessionTitle(session: SessionSummary): string {
	const fallback = session.last_user_goal?.trim() || session.id;
	return clip(session.title?.trim() || fallback, 72);
}

export async function consumeSse(
	response: Response,
	onEvent: (event: SseEvent) => void,
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
				onEvent(parsed);
			}

			boundary = buffer.indexOf('\n\n');
		}
	}
}

async function invokeAction<T>(
	serverUrl: string,
	agentId: string,
	actionName: string,
	body: Record<string, unknown> = {}
): Promise<T> {
	const response = await fetch(`${buildAgentUrl(serverUrl, agentId)}/action/${actionName}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		throw new Error(await readErrorResponse(response));
	}

	const data = (await response.json()) as { result?: T; error?: string };
	if (!response.ok || data.error) {
		throw new Error(data.error ?? `action failed with ${response.status}`);
	}

	if (data.result === undefined) {
		throw new Error('action response missing result');
	}

	return data.result;
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(await readErrorResponse(response));
	}
	return (await response.json()) as T;
}

function buildAgentUrl(serverUrl: string, agentId: string): string {
	return `${normalizeServerUrl(serverUrl)}/agent/${agentId}`;
}

async function readErrorResponse(response: Response): Promise<string> {
	const body = (await response.text()).trim();
	if (body) {
		return body;
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
		return JSON.parse(value) as string;
	} catch {
		return value;
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
