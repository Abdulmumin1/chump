import type { SessionsResponse } from "$lib/chump/types";
import { normalizeServerUrl } from "$lib/chump/api";

export type DaemonProjectStatus =
    | "ready"
    | "starting"
    | "busy"
    | "offline"
    | "error";

export type DaemonProject = {
    id: string;
    name: string;
    workspacePath: string;
    createdAt: number;
    lastOpenedAt: number;
    status: DaemonProjectStatus;
};

export type DaemonRuntime = {
    projectId: string;
    status: "stopped" | "running";
    serverUrl: string | null;
    pid: number | null;
};

export type DaemonConnection = {
    url: string;
    token: string;
};

export async function discoverLocalDaemon(): Promise<DaemonConnection | null> {
    const response = await fetch("/api/local-daemon/bootstrap", {
        headers: { accept: "application/json" },
        cache: "no-store",
    });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`daemon discovery failed with ${response.status}`);
    }
    const connection = (await response.json()) as Partial<DaemonConnection>;
    if (
        typeof connection.url !== "string" ||
        typeof connection.token !== "string"
    ) {
        throw new Error("daemon discovery returned an invalid connection");
    }
    return normalizeDaemonConnection({
        url: connection.url,
        token: connection.token,
    });
}

export async function listDaemonProjects(
    connection: DaemonConnection,
): Promise<DaemonProject[]> {
    const response = await daemonJson<{ projects: DaemonProject[] }>(
        connection,
        "/projects",
    );
    return response.projects;
}

export async function startDaemonProject(
    connection: DaemonConnection,
    projectId: string,
): Promise<DaemonRuntime> {
    const response = await daemonJson<{ runtime: DaemonRuntime }>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/runtime`,
        { method: "POST" },
    );
    return response.runtime;
}

export async function listDaemonProjectSessions(
    connection: DaemonConnection,
    projectId: string,
): Promise<SessionsResponse> {
    return await daemonJson<SessionsResponse>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/sessions`,
    );
}

export async function createDaemonProjectSession(
    connection: DaemonConnection,
    projectId: string,
): Promise<{ projectId: string; sessionId: string }> {
    return await daemonJson<{ projectId: string; sessionId: string }>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/sessions`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
        },
    );
}

export function normalizeDaemonConnection(
    connection: DaemonConnection,
): DaemonConnection {
    return {
        url: normalizeServerUrl(connection.url),
        token: connection.token.trim(),
    };
}

async function daemonJson<T>(
    connection: DaemonConnection,
    path: string,
    init: RequestInit = {},
): Promise<T> {
    const normalized = normalizeDaemonConnection(connection);
    const response = await fetch(`${normalized.url}${path}`, {
        ...init,
        headers: {
            ...init.headers,
            authorization: `Bearer ${normalized.token}`,
        },
    });
    if (!response.ok) {
        const body = (await response.text()).trim();
        throw new Error(body || `daemon request failed with ${response.status}`);
    }
    return (await response.json()) as T;
}
