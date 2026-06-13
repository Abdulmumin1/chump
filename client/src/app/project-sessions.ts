import { randomUUID } from "node:crypto";
import type { SessionSummary } from "../core/types.ts";
import { ProjectRuntimeSupervisor } from "./project-runtime.ts";

export type ProjectSessions = {
  projectId: string;
  sessions: SessionSummary[];
};

export type CreatedProjectSession = {
  projectId: string;
  sessionId: string;
};

export type ProjectSessionDependencies = {
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
};

export type SessionRequest = {
  method: string;
  path: "state" | "messages" | "chat" | "events" | `action/${string}`;
  query?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export class ProjectSessionRouter {
  private readonly runtimes: ProjectRuntimeSupervisor;
  private readonly fetchRequest;

  constructor(
    runtimes: ProjectRuntimeSupervisor,
    dependencies: ProjectSessionDependencies = {},
  ) {
    this.runtimes = runtimes;
    this.fetchRequest = dependencies.fetch ?? fetch;
  }

  async list(projectId: string): Promise<ProjectSessions | null> {
    const runtime = await this.runtimes.start(projectId);
    if (!runtime?.serverUrl) return null;
    const response = await this.fetchRequest(`${runtime.serverUrl}/sessions`);
    if (!response.ok) {
      throw new Error(`project session request failed with ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isSessionsResponse(body)) {
      throw new Error("project session response is invalid");
    }
    return {
      projectId,
      sessions: body.sessions,
    };
  }

  async create(
    projectId: string,
    requestedSessionId?: string,
  ): Promise<CreatedProjectSession | null> {
    const sessions = await this.list(projectId);
    if (!sessions) return null;
    const sessionId = requestedSessionId ?? generatedSessionId(projectId);
    if (!isValidSessionId(sessionId)) {
      throw new SessionCreationError(
        "invalid_session_id",
        "sessionId must contain only letters, numbers, dots, underscores, and hyphens",
      );
    }
    if (sessions.sessions.some((session) => session.id === sessionId)) {
      throw new SessionCreationError(
        "session_exists",
        `session already exists: ${sessionId}`,
      );
    }
    return { projectId, sessionId };
  }

  async request(
    projectId: string,
    sessionId: string,
    request: SessionRequest,
  ): Promise<Response | null> {
    const runtime = await this.runtimes.start(projectId);
    if (!runtime?.serverUrl) return null;
    const sessionPath = encodeURIComponent(sessionId);
    const target = new URL(
      `${runtime.serverUrl}/agent/${sessionPath}/${request.path}`,
    );
    if (request.query) target.search = request.query;
    return await this.fetchRequest(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
  }

  async projectRequest(
    projectId: string,
    path: "health" | "files",
    query = "",
  ): Promise<Response | null> {
    const runtime = await this.runtimes.start(projectId);
    if (!runtime?.serverUrl) return null;
    const target = new URL(`${runtime.serverUrl}/${path}`);
    target.search = query;
    return await this.fetchRequest(target);
  }
}

export class SessionCreationError extends Error {
  readonly code: "invalid_session_id" | "session_exists";

  constructor(
    code: "invalid_session_id" | "session_exists",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export function isValidSessionId(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function generatedSessionId(projectId: string): string {
  const projectSegment = projectId
    .replace(/^project-/, "")
    .slice(0, 8);
  return `session-${projectSegment}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function isSessionsResponse(
  value: unknown,
): value is { sessions: SessionSummary[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSessionSummary)
  );
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.active === "boolean" &&
    typeof value.message_count === "number" &&
    typeof value.event_count === "number" &&
    (value.title === null || typeof value.title === "string") &&
    (value.created_at === null || typeof value.created_at === "number") &&
    (value.updated_at === null || typeof value.updated_at === "number") &&
    (value.last_user_goal === null || typeof value.last_user_goal === "string") &&
    (value.last_activity === null || typeof value.last_activity === "number") &&
    typeof value.connections === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
