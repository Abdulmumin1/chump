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

export type DaemonGitResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
    message: string;
    url?: string;
};

export type DaemonConnection = {
    url: string;
    token: string;
};

export async function discoverLocalDaemon(): Promise<DaemonConnection | null> {
    const response = await fetch("/api/local-daemon/bootstrap", {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
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

export async function registerDaemonProject(
    connection: DaemonConnection,
    input: {
        workspacePath: string;
        name?: string;
        approved: true;
    },
): Promise<DaemonProject> {
    const response = await daemonJson<{ project: DaemonProject }>(
        connection,
        "/projects",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
        },
    );
    return response.project;
}

export async function pickDaemonProjectDirectory(
    connection: DaemonConnection,
): Promise<string | null> {
    const response = await daemonJson<{ workspacePath: string | null }>(
        connection,
        "/directory-picker",
        { method: "POST" },
    );
    return response.workspacePath;
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

export async function getDaemonProjectRuntime(
    connection: DaemonConnection,
    projectId: string,
): Promise<DaemonRuntime> {
    const response = await daemonJson<{ runtime: DaemonRuntime }>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/runtime`,
    );
    return response.runtime;
}

export async function stopDaemonProject(
    connection: DaemonConnection,
    projectId: string,
): Promise<DaemonRuntime> {
    const response = await daemonJson<{ runtime: DaemonRuntime }>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/runtime`,
        { method: "DELETE" },
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

export async function commitAndPushDaemonProjectChanges(
    connection: DaemonConnection,
    projectId: string,
    message: string,
    files: string[],
): Promise<DaemonGitResult> {
    return await daemonJson<DaemonGitResult>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/git/commit-push`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message, files }),
        },
    );
}

export async function createDaemonProjectPullRequest(
    connection: DaemonConnection,
    projectId: string,
    options: { title?: string; body?: string; draft?: boolean } = {},
): Promise<DaemonGitResult> {
    return await daemonJson<DaemonGitResult>(
        connection,
        `/projects/${encodeURIComponent(projectId)}/git/create-pr`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(options),
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
        signal: requestSignal(init.signal),
        headers: {
            ...init.headers,
            authorization: `Bearer ${normalized.token}`,
        },
    });
    if (!response.ok) {
        const body = (await response.text()).trim();
        throw new Error(readDaemonError(body) || `daemon request failed with ${response.status}`);
    }
    return (await response.json()) as T;
}

function readDaemonError(body: string): string {
    if (!body) return "";
    try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim()) {
            return parsed.message.trim();
        }
    } catch {
        // Fall back to the raw body below.
    }
    return body;
}

function requestSignal(signal?: AbortSignal | null): AbortSignal {
    const timeout = AbortSignal.timeout(10_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
