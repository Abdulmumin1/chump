import { DaemonAuthStore } from "./daemon-auth.ts";
import { runDaemonCommand } from "./daemon-command.ts";
import { DaemonMetadataStore, type DaemonMetadata } from "./daemon-metadata.ts";
import type { ProjectRuntime } from "./project-runtime.ts";
import type { Project } from "./projects.ts";

export type DaemonProjectTarget = {
  daemon: DaemonMetadata;
  project: Project;
  runtime: ProjectRuntime & {
    status: "running";
    serverUrl: string;
  };
};

export type DaemonClientDependencies = {
  ensureDaemon?: () => Promise<void>;
  readMetadata?: () => Promise<DaemonMetadata | null>;
  readToken?: () => Promise<string | null>;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
};

export async function ensureDaemonProjectTarget(
  workspacePath: string,
  dependencies: DaemonClientDependencies = {},
): Promise<DaemonProjectTarget> {
  const ensureDaemon = dependencies.ensureDaemon ?? (async () => {
    await runDaemonCommand("start");
  });
  const readMetadata = dependencies.readMetadata ?? (() =>
    new DaemonMetadataStore().readActive());
  const readToken = dependencies.readToken ?? (() =>
    new DaemonAuthStore().readToken());
  const request = dependencies.fetch ?? fetch;

  await ensureDaemon();
  const [daemon, token] = await Promise.all([readMetadata(), readToken()]);
  if (!daemon) {
    throw new Error("daemon metadata is unavailable after startup");
  }
  if (!token) {
    throw new Error("daemon credential is unavailable after startup");
  }

  const projectResponse = await request(`${daemon.url}/projects`, {
    method: "POST",
    headers: authenticatedJsonHeaders(token),
    body: JSON.stringify({
      workspacePath,
      approved: true,
    }),
  });
  const projectBody = await readJsonResponse(projectResponse);
  if (!projectResponse.ok || !isRecord(projectBody) || !isProject(projectBody.project)) {
    throw daemonRequestError("register project", projectResponse, projectBody);
  }

  const project = projectBody.project;
  const runtimeResponse = await request(
    `${daemon.url}/projects/${encodeURIComponent(project.id)}/runtime`,
    {
      method: "POST",
      headers: authenticatedHeaders(token),
    },
  );
  const runtimeBody = await readJsonResponse(runtimeResponse);
  if (
    !runtimeResponse.ok ||
    !isRecord(runtimeBody) ||
    !isRunningRuntime(runtimeBody.runtime)
  ) {
    throw daemonRequestError("start project runtime", runtimeResponse, runtimeBody);
  }

  return {
    daemon,
    project,
    runtime: runtimeBody.runtime,
  };
}

function authenticatedHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function authenticatedJsonHeaders(token: string): Record<string, string> {
  return {
    ...authenticatedHeaders(token),
    "content-type": "application/json",
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function daemonRequestError(
  action: string,
  response: Response,
  body: unknown,
): Error {
  const detail =
    isRecord(body) && typeof body.message === "string"
      ? `: ${body.message}`
      : "";
  return new Error(`failed to ${action} through daemon (${response.status})${detail}`);
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.lastOpenedAt === "number" &&
    typeof value.status === "string"
  );
}

function isRunningRuntime(
  value: unknown,
): value is DaemonProjectTarget["runtime"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.projectId === "string" &&
    value.status === "running" &&
    typeof value.serverUrl === "string" &&
    typeof value.pid === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
