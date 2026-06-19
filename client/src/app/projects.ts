import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getGlobalStatePaths } from "./state-paths.ts";

const PROJECT_REGISTRY_VERSION = 1;

export type ProjectStatus = "ready" | "starting" | "busy" | "offline" | "error";

export type Project = {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: number;
  lastOpenedAt: number;
  status: ProjectStatus;
};

type ProjectRegistry = {
  version: typeof PROJECT_REGISTRY_VERSION;
  projects: Project[];
};

export type ProjectRegistryOptions = {
  registryPath?: string;
  now?: () => number;
};

export class ProjectRegistryStore {
  readonly registryPath: string;
  private readonly now: () => number;

  constructor(options: ProjectRegistryOptions = {}) {
    this.registryPath = options.registryPath ?? getGlobalStatePaths().projectsPath;
    this.now = options.now ?? Date.now;
  }

  async list(): Promise<Project[]> {
    const registry = await this.read();
    return registry.projects
      .slice()
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  }

  async get(projectId: string): Promise<Project | null> {
    const registry = await this.read();
    const project = registry.projects.find((item) => item.id === projectId);
    return project ? structuredClone(project) : null;
  }

  async register(workspacePath: string, name?: string): Promise<Project> {
    const canonicalPath = await canonicalizeWorkspacePath(workspacePath);
    const registry = await this.read();
    const existing = registry.projects.find(
      (project) => project.workspacePath === canonicalPath,
    );
    const timestamp = this.now();

    if (existing) {
      existing.lastOpenedAt = timestamp;
      existing.status = "ready";
      if (name?.trim()) {
        existing.name = name.trim();
      }
      await this.write(registry);
      return structuredClone(existing);
    }

    const project: Project = {
      id: projectIdForPath(canonicalPath),
      name: name?.trim() || path.basename(canonicalPath) || canonicalPath,
      workspacePath: canonicalPath,
      createdAt: timestamp,
      lastOpenedAt: timestamp,
      status: "ready",
    };
    registry.projects.push(project);
    await this.write(registry);
    return structuredClone(project);
  }

  async remove(projectId: string): Promise<boolean> {
    const registry = await this.read();
    const projects = registry.projects.filter((project) => project.id !== projectId);
    if (projects.length === registry.projects.length) {
      return false;
    }
    await this.write({ ...registry, projects });
    return true;
  }

  async rename(projectId: string, name: string): Promise<Project | null> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("project name cannot be empty");
    }
    const registry = await this.read();
    const project = registry.projects.find((item) => item.id === projectId);
    if (!project) return null;
    project.name = normalizedName;
    await this.write(registry);
    return structuredClone(project);
  }

  private async read(): Promise<ProjectRegistry> {
    let raw: string;
    try {
      raw = await readFile(this.registryPath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return emptyRegistry();
      }
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isProjectRegistry(parsed)) {
      throw new Error(`invalid Chump project registry: ${this.registryPath}`);
    }
    return parsed;
  }

  private async write(registry: ProjectRegistry): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.registryPath);
  }
}

export async function canonicalizeWorkspacePath(workspacePath: string): Promise<string> {
  const resolvedPath = path.resolve(workspacePath);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new Error(`workspace does not exist: ${resolvedPath}`);
    }
    throw error;
  }
}

export function projectIdForPath(workspacePath: string): string {
  const digest = createHash("sha256")
    .update(path.resolve(workspacePath))
    .digest("hex")
    .slice(0, 16);
  return `project-${digest}`;
}

function emptyRegistry(): ProjectRegistry {
  return {
    version: PROJECT_REGISTRY_VERSION,
    projects: [],
  };
}

function isProjectRegistry(value: unknown): value is ProjectRegistry {
  if (!value || typeof value !== "object") return false;
  const registry = value as Record<string, unknown>;
  return (
    registry.version === PROJECT_REGISTRY_VERSION &&
    Array.isArray(registry.projects) &&
    registry.projects.every(isProject)
  );
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.workspacePath === "string" &&
    typeof project.createdAt === "number" &&
    typeof project.lastOpenedAt === "number" &&
    (
      project.status === "ready" ||
      project.status === "starting" ||
      project.status === "busy" ||
      project.status === "offline" ||
      project.status === "error"
    )
  );
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
