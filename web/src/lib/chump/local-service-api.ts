import type { SessionsResponse } from '$lib/chump/types';
import { normalizeServerUrl } from '$lib/chump/api';

export type LocalServiceProject = {
	id: string;
	name: string;
	workspacePath: string;
	createdAt: number;
	lastOpenedAt: number;
};

export type LocalServiceConnection = {
	url: string;
	token: string;
	projectId?: string;
};

export async function listLocalServiceProjects(
	connection: LocalServiceConnection
): Promise<LocalServiceProject[]> {
	const response = await localServiceJson<{ projects: LocalServiceProject[] }>(connection, '/projects');
	return response.projects;
}

export async function registerLocalServiceProject(
	connection: LocalServiceConnection,
	input: {
		workspacePath: string;
		name?: string;
		approved: true;
	}
): Promise<LocalServiceProject> {
	const response = await localServiceJson<{ project: LocalServiceProject }>(connection, '/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	return response.project;
}

export async function pickLocalServiceProjectDirectory(
	connection: LocalServiceConnection
): Promise<string | null> {
	const response = await localServiceJson<{ workspacePath: string | null }>(
		connection,
		'/directory-picker',
		{ method: 'POST' }
	);
	return response.workspacePath;
}

export async function listLocalServiceProjectSessions(
	connection: LocalServiceConnection,
	projectId: string
): Promise<SessionsResponse> {
	return await localServiceJson<SessionsResponse>(
		connection,
		`/projects/${encodeURIComponent(projectId)}/sessions`
	);
}

export async function createLocalServiceProjectSession(
	connection: LocalServiceConnection,
	projectId: string,
	sessionId?: string
): Promise<{ projectId: string; sessionId: string }> {
	return await localServiceJson<{ projectId: string; sessionId: string }>(
		connection,
		`/projects/${encodeURIComponent(projectId)}/sessions`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(sessionId ? { sessionId } : {})
		}
	);
}

export function normalizeLocalServiceConnection(
	connection: LocalServiceConnection
): LocalServiceConnection {
	const token = connection.token.trim();
	if (!token) {
		throw new Error('A local service token is required');
	}
	return {
		url: normalizeServerUrl(connection.url),
		token,
		...(connection.projectId?.trim() ? { projectId: connection.projectId.trim() } : {})
	};
}

async function localServiceJson<T>(
	connection: LocalServiceConnection,
	path: string,
	init: RequestInit = {}
): Promise<T> {
	const normalized = normalizeLocalServiceConnection(connection);
	const response = await fetch(`${normalized.url}${path}`, {
		...init,
		signal: requestSignal(init.signal),
		headers: {
			...init.headers,
			authorization: `Bearer ${normalized.token}`
		}
	});
	if (!response.ok) {
		const body = (await response.text()).trim();
		throw new Error(readLocalServiceError(body) || `local service request failed with ${response.status}`);
	}
	return (await response.json()) as T;
}

function readLocalServiceError(body: string): string {
	if (!body) return '';
	try {
		const parsed = JSON.parse(body) as { message?: unknown };
		return typeof parsed.message === 'string' ? parsed.message : body;
	} catch {
		return body;
	}
}

function requestSignal(signal: AbortSignal | null | undefined): AbortSignal {
	return signal ?? AbortSignal.timeout(10_000);
}
